import { getDb } from "../db";
import { ApiError } from "../errors";
import { notify } from "./notifications";
import { nowIso, userCity } from "./shared";

/**
 * Lista de deseos por obra (no por ejemplar): «avísame si aparece en mi
 * ciudad». Se guardan solo el libro y la cuenta; la ciudad se lee del perfil
 * en el momento de avisar, así que cambiar de ciudad no deja avisos viejos.
 */
export function setBookWant(
  userId: string,
  bookId: string,
  enabled: boolean,
): { wanted: boolean; count: number } {
  const db = getDb();
  const book = db.prepare("SELECT id FROM books WHERE id = ?").get(bookId);
  if (!book) throw new ApiError(404, "El libro no existe.");

  if (enabled) {
    db.prepare(
      "INSERT OR IGNORE INTO book_wants (user_id, book_id, created_at, last_notified_at) VALUES (?, ?, ?, NULL)",
    ).run(userId, bookId, nowIso());
  } else {
    db.prepare("DELETE FROM book_wants WHERE user_id = ? AND book_id = ?").run(
      userId,
      bookId,
    );
  }

  return {
    wanted: enabled,
    count: countBookWants(bookId, userCity(userId) ?? "", userId),
  };
}

export function isBookWanted(userId: string, bookId: string): boolean {
  return Boolean(
    getDb()
      .prepare("SELECT 1 FROM book_wants WHERE user_id = ? AND book_id = ?")
      .get(userId, bookId),
  );
}

/** Cuántas personas activas de esa ciudad buscan la obra (sin contar a quien mira). */
export function countBookWants(bookId: string, city: string, excludeUserId = ""): number {
  if (!city) return 0;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total
         FROM book_wants w
         JOIN users u ON u.id = w.user_id
        WHERE w.book_id = ? AND u.city = ? AND u.is_suspended = 0
          AND (? = '' OR u.id <> ?)`,
    )
    .get(bookId, city, excludeUserId, excludeUserId) as { total: number };
  return row.total;
}

/**
 * Avisa a quien busca la obra cuando alguien la publica en su ciudad. Se
 * limita a un aviso cada 7 días por persona y obra para no convertir la
 * bandeja en ruido si se publican varias copias seguidas.
 */
export function notifyBookWants(input: {
  ownerId: string;
  city: string;
  title: string;
  listingId: string;
  bookId: string;
}): void {
  const db = getDb();
  const recipients = db
    .prepare(
      `SELECT w.user_id AS id
         FROM book_wants w
         JOIN users u ON u.id = w.user_id
        WHERE w.book_id = ? AND u.city = ? AND u.id <> ? AND u.is_suspended = 0
          AND (w.last_notified_at IS NULL
               OR w.last_notified_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days'))
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
             WHERE (b.blocker_id = w.user_id AND b.blocked_id = ?)
                OR (b.blocker_id = ? AND b.blocked_id = w.user_id)
          )
        ORDER BY w.created_at ASC
        LIMIT 100`,
    )
    .all(input.bookId, input.city, input.ownerId, input.ownerId, input.ownerId) as {
    id: string;
  }[];

  const markNotified = db.prepare(
    "UPDATE book_wants SET last_notified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND book_id = ?",
  );
  for (const recipient of recipients) {
    notify({
      userId: recipient.id,
      type: "want",
      title: "Un libro que buscas ya está disponible",
      body: `«${input.title}» se ha publicado en ${input.city}.`,
      listingId: input.listingId,
      bookId: input.bookId,
      link: `/libro/${input.listingId}`,
    });
    markNotified.run(recipient.id, input.bookId);
  }
}
