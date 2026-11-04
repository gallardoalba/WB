import { randomUUID } from "node:crypto";
import { getDb, type Db } from "../db";
import { ApiError } from "../errors";
import type { ListingStatus, ListingView, PagedListings, SortMode } from "../domain";
import { coverFromIsbn, normalizeText } from "../text";
import type { CatalogParams, ListingInput } from "../validation";
import { getUserById, assertVerified } from "./users";
import { notifyAvailability } from "./alerts";
import { notifyBookWants } from "./wants";
import {
  BLOCK_FILTER,
  blockPair,
  distanceParts,
  ftsQuery,
  isConstraintError,
  listingSelect,
  nowIso,
  OWNER_ACTIVE,
  toListingView,
  VISIBILITY,
  type ListingRow,
} from "./shared";

export const PAGE_SIZE = 12;

const ORDER_BY: Record<SortMode, string> = {
  // `distance_km` es la distancia calculada desde la ciudad de quien mira.
  near: "distance_km IS NULL, distance_km ASC, l.created_at DESC",
  recent: "l.created_at DESC",
  title: "b.title COLLATE NOCASE ASC",
};

export function catalogPage(userId: string | null, params: CatalogParams): PagedListings {
  const db = getDb();
  const viewer = userId ?? "";
  const page = Math.max(1, params.page);
  const tokens = normalizeText(params.q).split(" ").filter(Boolean);
  // Sin sesión no hay ciudad desde la que medir: el radio se ignora.
  const radius = userId ? params.radius : 0;

  // Distancia real: ciudad de quien mira → ciudad del ejemplar (matriz
  // precalculada en `city_distances`).
  const distance = distanceParts(viewer);

  const clauses = [
    VISIBILITY,
    OWNER_ACTIVE,
    BLOCK_FILTER,
    "l.status = 'available'",
    params.category && params.category !== "Todos" ? "b.category = @category" : null,
    params.language && params.language !== "Todos" ? "b.language = @language" : null,
    // Radio real desde la ciudad de quien mira; sin ciudad no se inventa distancia.
    radius > 0
      ? `(${distance.expression}) IS NOT NULL AND (${distance.expression}) <= @radius`
      : null,
    // `listings_fts` respeta acentos y prefijos y usa su propio índice.
    tokens.length > 0 ? "l.rowid IN (SELECT rowid FROM listings_fts WHERE listings_fts MATCH @match)" : null,
    params.tag
      ? "EXISTS (SELECT 1 FROM listing_tags lt WHERE lt.listing_id = l.id AND lt.tag = @tag)"
      : null,
  ].filter(Boolean) as string[];

  const where = `WHERE ${clauses.join(" AND ")}`;
  const binds: Record<string, unknown> = {
    userId: viewer,
    category: params.category,
    language: params.language,
    radius,
    match: ftsQuery(tokens),
    tag: params.tag,
    fromCity: distance.fromCity,
  };

  const { total } = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM listings l JOIN books b ON b.id = l.book_id
       JOIN users u ON u.id = l.owner_id
       ${distance.join}
       ${where}`,
    )
    .get(binds) as { total: number };

  const rows = db
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join} ${where}
       ORDER BY ${ORDER_BY[params.sort]} LIMIT @limit OFFSET @offset`,
    )
    .all({ ...binds, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }) as ListingRow[];

  return {
    items: rows.map(toListingView),
    total,
    page,
    pageSize: PAGE_SIZE,
    hasMore: page * PAGE_SIZE < total,
  };
}

export function similarListings(bookId: string, viewerId: string | null, limit = 4): ListingView[] {
  const db = getDb();
  const distance = distanceParts(viewerId ?? "");
  const rows = db
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join}
       WHERE ${VISIBILITY} AND ${OWNER_ACTIVE} AND ${BLOCK_FILTER}
         AND l.status = 'available' AND l.book_id <> @bookId
         AND (
           b.category = (SELECT category FROM books WHERE id = @bookId)
           OR EXISTS (
             SELECT 1
               FROM listing_tags lt
               JOIN listings source ON source.id = lt.listing_id
               JOIN listing_tags candidate ON candidate.tag = lt.tag
              WHERE source.book_id = @bookId AND candidate.listing_id = l.id
           )
         )
       ORDER BY
         CASE WHEN b.category = (SELECT category FROM books WHERE id = @bookId) THEN 0 ELSE 1 END,
         l.created_at DESC
       LIMIT @limit`,
    )
    .all({
      userId: viewerId ?? "",
      bookId,
      fromCity: distance.fromCity,
      limit: Math.min(Math.max(limit, 1), 8),
    }) as ListingRow[];
  return rows.map(toListingView);
}

/** Convierte los tokens ya normalizados en una consulta FTS5 segura (prefijos, AND). */
export type ShelfFilter = "all" | "saved" | "mine";

export function shelfListings(
  userId: string,
  shelf: ShelfFilter = "all",
  page = 1,
): PagedListings {
  const condition =
    shelf === "saved"
      ? "f.user_id IS NOT NULL"
      : shelf === "mine"
        ? "l.owner_id = @userId"
        : "(f.user_id IS NOT NULL OR l.owner_id = @userId)";

  const db = getDb();
  const where = `WHERE ${VISIBILITY} AND ${OWNER_ACTIVE} AND ${condition}`;
  const { total } = db
    .prepare(
      `SELECT COUNT(*) AS total FROM listings l JOIN users u ON u.id = l.owner_id
       LEFT JOIN favorites f ON f.listing_id = l.id AND f.user_id = @userId
       ${where}`,
    )
    .get({ userId }) as { total: number };

  const safePage = Math.max(1, page);
  const distance = distanceParts(userId);
  const rows = db
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join}
       ${where}
       ORDER BY l.created_at DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({
      userId,
      fromCity: distance.fromCity,
      limit: PAGE_SIZE,
      offset: (safePage - 1) * PAGE_SIZE,
    }) as ListingRow[];

  return {
    items: rows.map(toListingView),
    total,
    page: safePage,
    pageSize: PAGE_SIZE,
    hasMore: safePage * PAGE_SIZE < total,
  };
}

export function getListing(id: string, viewerId: string | null): ListingView | null {
  // Un ejemplar pausado deja de ser público: solo lo ve quien lo publicó.
  const distance = distanceParts(viewerId);
  const row = getDb()
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join}
       WHERE l.id = @id AND ${VISIBILITY} AND ${OWNER_ACTIVE}
         AND (l.status <> 'paused' OR l.owner_id = @userId)
         AND ${blockPair("@userId", "l.owner_id")}`,
    )
    .get({
      id,
      userId: viewerId ?? "",
      fromCity: distance.fromCity,
    }) as ListingRow | undefined;
  return row ? toListingView(row) : null;
}

/** Las etiquetas son curadas y se guardan como conjunto por ejemplar. */
function writeListingTags(db: Db, listingId: string, tags: string[]): void {
  db.prepare("DELETE FROM listing_tags WHERE listing_id = ?").run(listingId);
  const insert = db.prepare("INSERT OR IGNORE INTO listing_tags (listing_id, tag) VALUES (?, ?)");
  for (const tag of tags.slice(0, 3)) insert.run(listingId, tag);
}

export function createListing(ownerId: string, input: ListingInput): ListingView {
  const db = getDb();
  const owner = getUserById(ownerId);
  if (!owner) throw new ApiError(401, "Necesitas iniciar sesión.");
  assertVerified(ownerId);

  const city = input.city ?? owner.city;
  const language = input.language ?? "No especificado";
  const titleKey = normalizeText(input.title);
  const searchKey = normalizeText(`${input.title} ${input.author} ${city}`);
  const now = nowIso();
  const coverUrl = coverFromIsbn(input.isbn);

  const listId = db.transaction(() => {
    const book = input.isbn
      ? (db.prepare("SELECT id FROM books WHERE isbn = ?").get(input.isbn) as { id: string } | undefined)
      : (db
          .prepare("SELECT id FROM books WHERE title_key = ? AND lower(author) = lower(?)")
          .get(titleKey, input.author) as { id: string } | undefined);

    let bookId = book?.id;
    if (!bookId) {
      const newBookId = `bok_${randomUUID()}`;
      try {
        db.prepare(
          "INSERT INTO books (id, title, title_key, author, isbn, category, language, cover_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(newBookId, input.title, titleKey, input.author, input.isbn, input.category, language, coverUrl, now);
        bookId = newBookId;
      } catch (error) {
        // Dos publicaciones simultáneas del mismo ISBN: la segunda reutiliza
        // el libro que acaba de crear la primera.
        if (!input.isbn || !isConstraintError(error)) throw error;
        const existing = db.prepare("SELECT id FROM books WHERE isbn = ?").get(input.isbn) as
          | { id: string }
          | undefined;
        if (!existing) throw error;
        bookId = existing.id;
      }
    }

    const listingId = `lst_${randomUUID()}`;
    // Si la edición ya existía sin idioma, la primera persona que lo sepa lo
    // completa; no se pisa un idioma ya indicado.
    if (input.language && input.language !== "No especificado") {
      db.prepare("UPDATE books SET language = ? WHERE id = ? AND language = 'No especificado'").run(
        input.language,
        bookId,
      );
    }
    db.prepare(
      `INSERT INTO listings (id, book_id, owner_id, condition, city, distance_km, status, search_key, notes, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'available', ?, '', ?)`,
    ).run(listingId, bookId, ownerId, input.condition, city, searchKey, now);

    db.prepare(
      "INSERT INTO events (id, type, actor_id, listing_id, request_id, created_at) VALUES (?, 'published', ?, ?, NULL, ?)",
    ).run(`evt_${randomUUID()}`, ownerId, listingId, now);

    writeListingTags(db, listingId, input.tags);

    return listingId;
  })();

  const listing = getListing(listId, ownerId);
  if (!listing) throw new ApiError(500, "No se pudo publicar el libro.");
  // Aviso a quien sigue la ciudad (bandeja interna, sin correo).
  notifyAvailability({
    ownerId,
    city,
    title: input.title,
    listingId: listId,
    bookId: listing.bookId,
  });
  notifyBookWants({
    ownerId,
    city,
    title: input.title,
    listingId: listId,
    bookId: listing.bookId,
  });
  return listing;
}

export function setListingStatus(
  ownerId: string,
  listingId: string,
  status: "available" | "paused",
): void {
  const db = getDb();
  // La comprobación va dentro del UPDATE: así dos peticiones simultáneas no
  // pueden saltarse la regla entre el SELECT y la escritura.
  const { changes } = db
    .prepare(
      `UPDATE listings SET status = ?
       WHERE id = ? AND owner_id = ? AND status IN ('available','paused')`,
    )
    .run(status, listingId, ownerId);

  if (changes === 0) {
    const row = db
      .prepare("SELECT owner_id, status FROM listings WHERE id = ? AND status <> 'removed'")
      .get(listingId) as { owner_id: string; status: ListingStatus } | undefined;
    if (!row) throw new ApiError(404, "El ejemplar no existe.");
    if (row.owner_id !== ownerId) {
      throw new ApiError(403, "Solo puedes gestionar tus publicaciones.");
    }
    throw new ApiError(409, "No puedes cambiar la disponibilidad de un ejemplar reservado o entregado.");
  }
}

/** Edita los datos propios del ejemplar (no los del libro, que se comparte). */
export function editListing(
  ownerId: string,
  listingId: string,
  patch: { condition: string; city: string; notes: string; tags: string[] },
): void {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT l.owner_id, l.status, b.title, b.author
       FROM listings l JOIN books b ON b.id = l.book_id
       WHERE l.id = ? AND l.status <> 'removed'`,
    )
    .get(listingId) as
    | { owner_id: string; status: ListingStatus; title: string; author: string }
    | undefined;

  if (!row) throw new ApiError(404, "El ejemplar no existe.");
  if (row.owner_id !== ownerId) throw new ApiError(403, "Solo puedes editar tus publicaciones.");

  db.transaction(() => {
    db.prepare(
      "UPDATE listings SET condition = ?, city = ?, notes = ?, search_key = ? WHERE id = ?",
    ).run(
      patch.condition,
      patch.city,
      patch.notes,
      normalizeText(`${row.title} ${row.author} ${patch.city}`),
      listingId,
    );
    writeListingTags(db, listingId, patch.tags);
  })();
}

export function removeListing(ownerId: string, listingId: string): void {
  const db = getDb();
  const now = nowIso();
  let changes = 0;

  db.transaction(() => {
    // Estado y dueño se comprueban en el propio UPDATE (sin ventana TOCTOU).
    changes = db
      .prepare(
        `UPDATE listings SET status = 'removed'
         WHERE id = ? AND owner_id = ? AND status IN ('available','paused','given')`,
      )
      .run(listingId, ownerId).changes;
    if (changes === 0) return;
    db.prepare(
      "UPDATE requests SET status = 'expired', updated_at = ? WHERE listing_id = ? AND status = 'pending'",
    ).run(now, listingId);
  })();

  if (changes === 0) {
    const row = db
      .prepare("SELECT owner_id, status FROM listings WHERE id = ? AND status <> 'removed'")
      .get(listingId) as { owner_id: string; status: ListingStatus } | undefined;
    if (!row) throw new ApiError(404, "El ejemplar no existe.");
    if (row.owner_id !== ownerId) {
      throw new ApiError(403, "Solo puedes gestionar tus publicaciones.");
    }
    throw new ApiError(409, "Tienes un intercambio aceptado: cancélalo antes de retirar el libro.");
  }
}

export function setFavorite(userId: string, listingId: string, favorite: boolean): void {
  const db = getDb();
  const listing = db
    .prepare(
      `SELECT 1 FROM listings l JOIN users u ON u.id = l.owner_id
       WHERE l.id = ? AND l.status <> 'removed' AND u.is_suspended = 0`,
    )
    .get(listingId);
  if (!listing) throw new ApiError(404, "El ejemplar no existe.");
  if (favorite) {
    db.prepare(
      "INSERT OR IGNORE INTO favorites (user_id, listing_id, created_at) VALUES (?, ?, ?)",
    ).run(userId, listingId, nowIso());
  } else {
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND listing_id = ?").run(userId, listingId);
  }
}

/* ----------------------------- ficha de la obra ---------------------------- */

export type BookView = {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  category: string;
  language: string;
  coverUrl: string | null;
};

/** Obras que una cuenta tiene publicadas ahora mismo (para elegir lectura). */
export function listOwnerBooks(userId: string): { id: string; title: string; author: string }[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT b.id, b.title, b.author
       FROM listings l JOIN books b ON b.id = l.book_id
       WHERE l.owner_id = ? AND l.status <> 'removed'
       ORDER BY b.title COLLATE NOCASE ASC
       LIMIT 100`,
    )
    .all(userId) as { id: string; title: string; author: string }[];
  return rows;
}

/** Obra canónica: es donde vive la conversación de un título. */
export function getBook(bookId: string): BookView | null {
  const row = getDb()
    .prepare("SELECT id, title, author, isbn, category, language, cover_url FROM books WHERE id = ?")
    .get(bookId) as
    | {
        id: string;
        title: string;
        author: string;
        isbn: string | null;
        category: string;
        language: string;
        cover_url: string | null;
      }
    | undefined;
  return row
    ? {
        id: row.id,
        title: row.title,
        author: row.author,
        isbn: row.isbn,
        category: row.category,
        language: row.language,
        coverUrl: row.cover_url,
      }
    : null;
}

/** Copias disponibles de una obra, ordenadas por cercanía y estado. */
export function listingsForBook(
  bookId: string,
  viewerId: string | null,
  options: { city?: string; availableOnly?: boolean; limit?: number } = {},
): ListingView[] {
  const distance = distanceParts(viewerId);
  // Los filtros van en SQL: filtrar después del LIMIT dejaba fuera ejemplares
  // de la ciudad del club si las primeras copias eran de otro sitio.
  const filters = [
    "l.book_id = @bookId",
    VISIBILITY,
    OWNER_ACTIVE,
    BLOCK_FILTER,
    options.city ? "l.city = @city" : "",
    options.availableOnly ? "l.status = 'available'" : "",
  ]
    .filter(Boolean)
    .join(" AND ");
  const rows = getDb()
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join}
       WHERE ${filters}
       ORDER BY (l.status = 'available') DESC, distance_km IS NULL, distance_km ASC, l.created_at DESC
       LIMIT @limit`,
    )
    .all({
      bookId,
      userId: viewerId ?? "",
      fromCity: distance.fromCity,
      limit: options.limit ?? 50,
      ...(options.city ? { city: options.city } : {}),
    }) as ListingRow[];
  return rows.map(toListingView);
}

/** Ejemplares visibles de una obra, sin el tope de la lista: da la cifra real. */
export function countListingsForBook(bookId: string, viewerId: string | null): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS value FROM listings l
        WHERE l.book_id = @bookId AND ${VISIBILITY} AND ${OWNER_ACTIVE} AND ${BLOCK_FILTER}`,
    )
    .get({ bookId, userId: viewerId ?? "" }) as { value: number };
  return row.value;
}

export function listSitemapEntries() {
  const db = getDb();
  const listings = db
    .prepare(
      `SELECT l.id, l.created_at FROM listings l
         JOIN users u ON u.id = l.owner_id
        WHERE l.status = 'available' AND u.is_suspended = 0
        ORDER BY l.created_at DESC LIMIT 500`,
    )
    .all() as { id: string; created_at: string }[];
  const users = db
    .prepare(
      `SELECT u.id FROM users u
       WHERE u.is_suspended = 0
         AND EXISTS (SELECT 1 FROM listings l WHERE l.owner_id = u.id AND l.status = 'available')
       ORDER BY u.created_at DESC LIMIT 500`,
    )
    .all() as { id: string }[];
  // Cada obra tiene su propia conversación: también se indexa.
  const books = db
    .prepare(
      `SELECT b.id FROM books b
       WHERE EXISTS (SELECT 1 FROM listings l JOIN users u ON u.id = l.owner_id
                      WHERE l.book_id = b.id AND l.status = 'available' AND u.is_suspended = 0)
       ORDER BY b.created_at DESC LIMIT 500`,
    )
    .all() as { id: string }[];
  return { listings, users, books };
}
