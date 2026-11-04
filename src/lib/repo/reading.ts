import { getDb } from "../db";
import { ApiError } from "../errors";
import type { ReadingStatus } from "../domain";
import { nowIso } from "./shared";

export function getReadingState(userId: string, bookId: string): ReadingStatus | null {
  const row = getDb()
    .prepare("SELECT status FROM reading_states WHERE user_id = ? AND book_id = ?")
    .get(userId, bookId) as { status: ReadingStatus } | undefined;
  return row?.status ?? null;
}

export function setReadingState(
  userId: string,
  bookId: string,
  status: ReadingStatus | null,
): { status: ReadingStatus | null; reading: number; read: number } {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM books WHERE id = ?").get(bookId)) {
    throw new ApiError(404, "El libro no existe.");
  }
  if (status) {
    db.prepare(
      `INSERT INTO reading_states (user_id, book_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, book_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    ).run(userId, bookId, status, nowIso(), nowIso());
  } else {
    db.prepare("DELETE FROM reading_states WHERE user_id = ? AND book_id = ?").run(
      userId,
      bookId,
    );
  }
  return { status, ...countReadingStates(bookId) };
}

export function countReadingStates(bookId: string): { reading: number; read: number } {
  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) AS total
         FROM reading_states
        WHERE book_id = ?
        GROUP BY status`,
    )
    .all(bookId) as { status: ReadingStatus; total: number }[];
  const result = { reading: 0, read: 0 };
  for (const row of rows) result[row.status] = row.total;
  return result;
}
