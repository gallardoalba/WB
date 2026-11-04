import { randomUUID } from "node:crypto";
import { getDb, type Db } from "../db";
import { ApiError } from "../errors";
import { notify } from "./notifications";
import { nowIso } from "./shared";

export type ClubLoanView = {
  id: string;
  clubId: string;
  listingId: string;
  title: string;
  lender: { id: string; name: string };
  borrower: { id: string; name: string };
  dueAt: string | null;
  returnedAt: string | null;
  createdAt: string;
};

type LoanRow = {
  id: string;
  club_id: string;
  listing_id: string;
  title: string;
  lender_id: string;
  lender_name: string;
  borrower_id: string;
  borrower_name: string;
  due_at: string | null;
  returned_at: string | null;
  created_at: string;
};

function toLoanView(row: LoanRow): ClubLoanView {
  return {
    id: row.id,
    clubId: row.club_id,
    listingId: row.listing_id,
    title: row.title,
    lender: { id: row.lender_id, name: row.lender_name },
    borrower: { id: row.borrower_id, name: row.borrower_name },
    dueAt: row.due_at,
    returnedAt: row.returned_at,
    createdAt: row.created_at,
  };
}

/**
 * Préstamos de un club. Solo los miembros (incluido quien lo creó) ven quién
 * presta qué a quién: no es información pública de la plataforma.
 */
export function listClubLoans(clubId: string, viewerId: string): ClubLoanView[] {
  const db = getDb();
  const club = db.prepare("SELECT owner_id FROM clubs WHERE id = ?").get(clubId) as
    | { owner_id: string }
    | undefined;
  if (!club) return [];
  if (!isClubMember(db, clubId, viewerId, club.owner_id)) return [];

  const rows = db
    .prepare(
      `SELECT cl.id, cl.club_id, cl.listing_id, b.title,
              cl.lender_id, lender.name AS lender_name,
              cl.borrower_id, borrower.name AS borrower_name,
              cl.due_at, cl.returned_at, cl.created_at
         FROM club_loans cl
         JOIN listings l ON l.id = cl.listing_id
         JOIN books b ON b.id = l.book_id
         JOIN users lender ON lender.id = cl.lender_id
         JOIN users borrower ON borrower.id = cl.borrower_id
        WHERE cl.club_id = ?
        ORDER BY (cl.returned_at IS NULL) DESC, cl.created_at DESC
        LIMIT 50`,
    )
    .all(clubId) as LoanRow[];
  return rows.map(toLoanView);
}

function isClubMember(db: Db, clubId: string, userId: string, ownerId: string): boolean {
  if (userId === ownerId) return true;
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'member'",
      )
      .get(clubId, userId),
  );
}

export function createClubLoan(input: {
  clubId: string;
  listingId: string;
  lenderId: string;
  borrowerId: string;
  dueAt?: string | null;
}): ClubLoanView {
  const db = getDb();
  const club = db.prepare("SELECT id, city, owner_id FROM clubs WHERE id = ? AND status = 'visible'").get(
    input.clubId,
  ) as { id: string; city: string; owner_id: string } | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  if (input.lenderId === input.borrowerId) {
    throw new ApiError(409, "No puedes prestarte un libro a ti misma.");
  }
  if (!isClubMember(db, club.id, input.lenderId, club.owner_id)) {
    throw new ApiError(403, "Solo los miembros del club pueden prestar ejemplares.");
  }
  if (!isClubMember(db, club.id, input.borrowerId, club.owner_id)) {
    throw new ApiError(409, "La persona que recibe el préstamo debe ser miembro del club.");
  }

  const listing = db
    .prepare("SELECT owner_id, status, city FROM listings WHERE id = ? AND status = 'available'")
    .get(input.listingId) as { owner_id: string; status: string; city: string } | undefined;
  if (!listing || listing.owner_id !== input.lenderId) {
    throw new ApiError(404, "Ese ejemplar no está disponible para prestar.");
  }
  if (listing.city !== club.city) {
    throw new ApiError(409, "El ejemplar debe estar en la ciudad del club.");
  }

  const id = `loan_${randomUUID()}`;
  const now = nowIso();
  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO club_loans (id, club_id, listing_id, lender_id, borrower_id, due_at, returned_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      ).run(id, club.id, input.listingId, input.lenderId, input.borrowerId, input.dueAt ?? null, now);
      db.prepare("UPDATE listings SET status = 'reserved' WHERE id = ? AND status = 'available'").run(
        input.listingId,
      );
      notify({
        userId: input.borrowerId,
        type: "club",
        title: "Préstamo de club",
        body: `«${titleOf(input.listingId)}» te lo presta ${nameOf(input.lenderId)}.`,
        bookId: bookIdOf(input.listingId),
        link: `/clubes/${club.id}`,
      });
      notify({
        userId: input.lenderId,
        type: "club",
        title: "Préstamo de club",
        body: `Has prestado «${titleOf(input.listingId)}» a ${nameOf(input.borrowerId)}.`,
        bookId: bookIdOf(input.listingId),
        link: `/clubes/${club.id}`,
      });
    })();
  } catch (error) {
    if (error instanceof Error && "code" in error && String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      throw new ApiError(409, "Ese ejemplar ya está prestado.");
    }
    throw error;
  }

  const row = db
    .prepare(
      `SELECT cl.id, cl.club_id, cl.listing_id, b.title,
              cl.lender_id, lender.name AS lender_name,
              cl.borrower_id, borrower.name AS borrower_name,
              cl.due_at, cl.returned_at, cl.created_at
         FROM club_loans cl
         JOIN listings l ON l.id = cl.listing_id
         JOIN books b ON b.id = l.book_id
         JOIN users lender ON lender.id = cl.lender_id
         JOIN users borrower ON borrower.id = cl.borrower_id
        WHERE cl.id = ?`,
    )
    .get(id) as LoanRow;
  return toLoanView(row);
}

export function returnClubLoan(loanId: string, userId: string): ClubLoanView {
  const db = getDb();
  const loan = db
    .prepare(
      "SELECT id, club_id, listing_id, lender_id, borrower_id, returned_at FROM club_loans WHERE id = ?",
    )
    .get(loanId) as
    | {
        id: string;
        club_id: string;
        listing_id: string;
        lender_id: string;
        borrower_id: string;
        returned_at: string | null;
      }
    | undefined;
  if (!loan) throw new ApiError(404, "El préstamo no existe.");
  if (loan.lender_id !== userId && loan.borrower_id !== userId) {
    throw new ApiError(404, "El préstamo no existe.");
  }
  if (loan.returned_at) throw new ApiError(409, "Este préstamo ya se ha devuelto.");

  const now = nowIso();
  const otherId = loan.lender_id === userId ? loan.borrower_id : loan.lender_id;
  db.transaction(() => {
    db.prepare("UPDATE club_loans SET returned_at = ? WHERE id = ?").run(now, loan.id);
    db.prepare("UPDATE listings SET status = 'available' WHERE id = ? AND status = 'reserved'").run(
      loan.listing_id,
    );
    notify({
      userId: otherId,
      type: "club",
      title: "Préstamo de club devuelto",
      body: `«${titleOf(loan.listing_id)}» vuelve a estar disponible en el club.`,
      bookId: bookIdOf(loan.listing_id),
      link: `/clubes/${loan.club_id}`,
    });
  })();

  const row = db
    .prepare(
      `SELECT cl.id, cl.club_id, cl.listing_id, b.title,
              cl.lender_id, lender.name AS lender_name,
              cl.borrower_id, borrower.name AS borrower_name,
              cl.due_at, cl.returned_at, cl.created_at
         FROM club_loans cl
         JOIN listings l ON l.id = cl.listing_id
         JOIN books b ON b.id = l.book_id
         JOIN users lender ON lender.id = cl.lender_id
         JOIN users borrower ON borrower.id = cl.borrower_id
        WHERE cl.id = ?`,
    )
    .get(loan.id) as LoanRow;
  return toLoanView(row);
}

function titleOf(listingId: string): string {
  const row = getDb()
    .prepare("SELECT b.title FROM listings l JOIN books b ON b.id = l.book_id WHERE l.id = ?")
    .get(listingId) as { title: string } | undefined;
  return row?.title ?? "el libro";
}

function bookIdOf(listingId: string): string | null {
  const row = getDb().prepare("SELECT book_id FROM listings WHERE id = ?").get(listingId) as
    | { book_id: string }
    | undefined;
  return row?.book_id ?? null;
}

function nameOf(userId: string): string {
  const row = getDb().prepare("SELECT name FROM users WHERE id = ?").get(userId) as
    | { name: string }
    | undefined;
  return row?.name ?? "alguien";
}
