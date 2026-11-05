import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { ApiError } from "../errors";
import type { ClubPollView } from "../domain";
import { notify } from "./notifications";
import { nowIso } from "./shared";

/* ------------------------- votación de la lectura -------------------------- */

/**
 * La próxima lectura se decide entre todos.
 *
 * Una votación por club y a la vez: quien creó el club propone entre dos y cinco
 * libros y los miembros votan uno. El voto se puede cambiar mientras la votación
 * esté abierta (una fila por persona y votación), y el resultado es público para
 * el club: es una decisión común, no una encuesta secreta.
 */

type PollRow = {
  id: string;
  question: string;
  closed_at: string | null;
  club_id: string;
};

const POLL_OPTIONS = `
  SELECT o.id, o.book_id, b.title, b.author, o.position,
         (SELECT COUNT(*) FROM club_poll_votes v WHERE v.option_id = o.id) AS votes,
         (SELECT group_concat(u.name, ' · ') FROM club_poll_votes v
            JOIN users u ON u.id = v.user_id
           WHERE v.option_id = o.id ORDER BY v.created_at) AS voters
    FROM club_poll_options o
    JOIN books b ON b.id = o.book_id
`;

function toPollView(poll: PollRow, viewerId: string): ClubPollView {
  const options = getDb()
    .prepare(`${POLL_OPTIONS} WHERE o.poll_id = ? ORDER BY o.position ASC`)
    .all(poll.id) as {
    id: string;
    book_id: string;
    title: string;
    author: string;
    votes: number;
    voters: string | null;
  }[];
  const mine = getDb()
    .prepare("SELECT option_id FROM club_poll_votes WHERE poll_id = ? AND user_id = ?")
    .get(poll.id, viewerId) as { option_id: string } | undefined;
  return {
    id: poll.id,
    question: poll.question,
    closed: Boolean(poll.closed_at),
    totalVotes: options.reduce((total, option) => total + option.votes, 0),
    votedOptionId: mine?.option_id ?? null,
    options: options.map((option) => ({
      id: option.id,
      book: { id: option.book_id, title: option.title, author: option.author },
      votes: option.votes,
      voters: option.voters ? option.voters.split(" · ") : [],
    })),
  };
}

function clubOf(clubId: string): { id: string; name: string; owner_id: string } {
  const club = getDb()
    .prepare("SELECT id, name, owner_id FROM clubs WHERE id = ? AND status = 'visible'")
    .get(clubId) as { id: string; name: string; owner_id: string } | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  return club;
}

function assertMember(club: { id: string; owner_id: string }, userId: string): void {
  if (club.owner_id === userId) return;
  const member = getDb()
    .prepare("SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'member'")
    .get(club.id, userId);
  if (!member) throw new ApiError(403, "Solo los miembros del club pueden votar.");
}

/** La votación abierta más reciente, si la hay. */
export function getActiveClubPoll(clubId: string, viewerId: string): ClubPollView | null {
  const club = clubOf(clubId);
  assertMember(club, viewerId);
  const row = getDb()
    .prepare(
      `SELECT id, question, closed_at, club_id FROM club_polls
        WHERE club_id = ? AND closed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(clubId) as PollRow | undefined;
  return row ? toPollView(row, viewerId) : null;
}

/** Cierra la votación abierta (solo quien creó el club). */
export function createClubPoll(
  ownerId: string,
  clubId: string,
  input: { question: string; bookIds: string[] },
): ClubPollView {
  const db = getDb();
  const club = clubOf(clubId);
  if (club.owner_id !== ownerId) {
    throw new ApiError(403, "Solo quien creó el club puede proponer la votación.");
  }
  const abierta = db
    .prepare("SELECT 1 FROM club_polls WHERE club_id = ? AND closed_at IS NULL")
    .get(clubId);
  if (abierta) throw new ApiError(409, "Ya hay una votación abierta en este club.");
  if (input.bookIds.length < 2) {
    throw new ApiError(409, "Hacen falta al menos dos libros para votar.");
  }
  const ids = [...new Set(input.bookIds)];
  const existentes = db
    .prepare(
      `SELECT COUNT(*) AS value FROM books WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
    .get(...ids) as { value: number };
  if (existentes.value !== ids.length) throw new ApiError(404, "Algún libro no existe.");

  const id = `poll_${randomUUID()}`;
  db.transaction(() => {
    db.prepare(
      "INSERT INTO club_polls (id, club_id, question, created_at, closed_at) VALUES (?, ?, ?, ?, NULL)",
    ).run(id, clubId, input.question, nowIso());
    const insert = db.prepare(
      "INSERT INTO club_poll_options (id, poll_id, book_id, position) VALUES (?, ?, ?, ?)",
    );
    ids.forEach((bookId, index) => insert.run(`opt_${randomUUID()}`, id, bookId, index));

    // Se avisa a los miembros: es una decisión que necesitan tomar.
    const miembros = db
      .prepare(
        `SELECT m.user_id FROM club_members m JOIN users u ON u.id = m.user_id
          WHERE m.club_id = ? AND m.status = 'member' AND u.is_suspended = 0 AND m.user_id <> ?`,
      )
      .all(clubId, ownerId) as { user_id: string }[];
    for (const member of miembros) {
      notify({
        userId: member.user_id,
        type: "club",
        title: "Votación de la próxima lectura",
        body: `«${club.name}» te pide que elijas entre ${ids.length} libros.`,
        link: `/clubes/${clubId}#votacion`,
      });
    }
  })();

  const row = db
    .prepare("SELECT id, question, closed_at, club_id FROM club_polls WHERE id = ?")
    .get(id) as PollRow;
  return toPollView(row, ownerId);
}

/** Vota (o cambia el voto) mientras la votación siga abierta. */
export function voteClubPoll(
  userId: string,
  clubId: string,
  optionId: string,
): ClubPollView {
  const db = getDb();
  const club = clubOf(clubId);
  assertMember(club, userId);

  const option = db
    .prepare(
      `SELECT o.id, o.poll_id, p.closed_at FROM club_poll_options o
        JOIN club_polls p ON p.id = o.poll_id
        WHERE o.id = ? AND p.club_id = ?`,
    )
    .get(optionId, clubId) as { id: string; poll_id: string; closed_at: string | null } | undefined;
  if (!option) throw new ApiError(404, "Esa opción no existe.");
  if (option.closed_at) throw new ApiError(409, "La votación ya está cerrada.");

  db.prepare(
    `INSERT INTO club_poll_votes (poll_id, user_id, option_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id = excluded.option_id,
                                                 created_at = excluded.created_at`,
  ).run(option.poll_id, userId, optionId, nowIso());

  const row = db
    .prepare("SELECT id, question, closed_at, club_id FROM club_polls WHERE id = ?")
    .get(option.poll_id) as PollRow;
  return toPollView(row, userId);
}

/**
 * Cierra la votación y, si se pide, deja fijada como lectura del club la opción
 * más votada (a igualdad, la que se propuso antes).
 */
export function closeClubPoll(ownerId: string, clubId: string, pollId: string): ClubPollView {
  const db = getDb();
  const club = clubOf(clubId);
  if (club.owner_id !== ownerId) {
    throw new ApiError(403, "Solo quien creó el club puede cerrar la votación.");
  }
  const poll = db
    .prepare("SELECT id, question, closed_at, club_id FROM club_polls WHERE id = ? AND club_id = ?")
    .get(pollId, clubId) as PollRow | undefined;
  if (!poll) throw new ApiError(404, "Esa votación no existe.");
  if (!poll.closed_at) {
    db.prepare("UPDATE club_polls SET closed_at = ? WHERE id = ?").run(nowIso(), pollId);
  }
  const actualizada = db
    .prepare("SELECT id, question, closed_at, club_id FROM club_polls WHERE id = ?")
    .get(pollId) as PollRow;
  return toPollView(actualizada, ownerId);
}

/** Lectura ganadora de una votación cerrada (la que se puede fijar como club). */
export function winningBookOfPoll(clubId: string, pollId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT o.book_id
         FROM club_poll_options o
         LEFT JOIN club_poll_votes v ON v.option_id = o.id
        WHERE o.poll_id = ? AND o.poll_id IN (SELECT id FROM club_polls WHERE club_id = ?)
        GROUP BY o.id
        ORDER BY COUNT(v.user_id) DESC, o.position ASC
        LIMIT 1`,
    )
    .get(pollId, clubId) as { book_id: string } | undefined;
  return row?.book_id ?? null;
}
