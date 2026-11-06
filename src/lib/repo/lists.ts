import { randomUUID } from "node:crypto";
import { getDb, type Db } from "../db";
import { ApiError } from "../errors";
import type { ReadingListDetail, ReadingListView } from "../domain";
import { blockPair, nowIso } from "./shared";

/* ---------------------------- listas de lectura --------------------------- */

type ListRow = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  owner_id: string;
  owner_name: string;
  show_owner: number;
  items: number;
};

const LIST_SELECT = `
  SELECT rl.id, rl.title, rl.description, rl.created_at, rl.show_owner,
         u.id AS owner_id, u.name AS owner_name,
         (SELECT COUNT(*) FROM reading_list_items i WHERE i.list_id = rl.id) AS items
  FROM reading_lists rl
  JOIN users u ON u.id = rl.owner_id
`;

function toListRow(row: ListRow, viewerId: string | null): ReadingListView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    items: row.items,
    owner: { id: row.owner_id, name: row.owner_name },
    isMine: row.owner_id === viewerId,
    showOwner: Boolean(row.show_owner),
  };
}

function assertListOwner(db: Db, listId: string, userId: string): void {
  const row = db.prepare("SELECT owner_id FROM reading_lists WHERE id = ?").get(listId) as
    | { owner_id: string }
    | undefined;
  if (!row) throw new ApiError(404, "La lista no existe.");
  if (row.owner_id !== userId) throw new ApiError(403, "Solo puedes editar tus listas.");
}

export function createReadingList(
  ownerId: string,
  input: { title: string; description: string; showOwner?: boolean },
): ReadingListView {
  const db = getDb();
  const total = (
    db.prepare("SELECT COUNT(*) AS value FROM reading_lists WHERE owner_id = ?").get(ownerId) as {
      value: number;
    }
  ).value;
  if (total >= 30) throw new ApiError(409, "Puedes tener hasta 30 listas.");

  const id = `lst_${randomUUID()}`;
  db.prepare(
    "INSERT INTO reading_lists (id, owner_id, title, description, show_owner, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    ownerId,
    input.title,
    input.description,
    input.showOwner ? 1 : 0,
    nowIso(),
  );

  const row = db.prepare(`${LIST_SELECT} WHERE rl.id = ?`).get(id) as ListRow;
  return toListRow(row, ownerId);
}

/** Listas de una cuenta (públicas: la comunidad puede leerlas). */
export function listReadingLists(ownerId: string, viewerId: string | null): ReadingListView[] {
  const rows = getDb()
    .prepare(
      `${LIST_SELECT}
       WHERE rl.owner_id = @ownerId AND u.is_suspended = 0
         AND ${blockPair("@viewerId", "rl.owner_id")}
       ORDER BY rl.created_at DESC
       LIMIT 30`,
    )
    .all({ ownerId, viewerId: viewerId ?? "" }) as ListRow[];
  return rows.map((row) => toListRow(row, viewerId));
}

/**
 * Escaparate de listas públicas: las de cuentas activas, con el número de obras
 * y quien las firma. Es lo que faltaba para que una lista se pudiera descubrir
 * sin conocer su enlace.
 */
export function listPublicReadingLists(options: {
  viewerId: string | null;
  q?: string;
  page?: number;
  pageSize?: number;
}): { lists: ReadingListView[]; total: number; hasMore: boolean } {
  const db = getDb();
  const viewerId = options.viewerId ?? "";
  const pageSize = Math.min(Math.max(options.pageSize ?? 12, 1), 48);
  const page = Math.max(1, options.page ?? 1);
  const like = `%${(options.q ?? "").trim().replace(/[%_]/g, "")}%`;

  const where = `
    u.is_suspended = 0
    AND u.email NOT LIKE 'deleted-%'
    AND (@like = '%%' OR unaccent(rl.title) LIKE unaccent(@like)
         OR unaccent(rl.description) LIKE unaccent(@like))
    AND ${blockPair("@viewerId", "rl.owner_id")}
  `;

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS value FROM reading_lists rl JOIN users u ON u.id = rl.owner_id WHERE ${where}`)
      .get({ viewerId, like }) as { value: number }
  ).value;

  const rows = db
    .prepare(
      `${LIST_SELECT}
       WHERE ${where}
       ORDER BY items DESC, rl.created_at DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ viewerId, like, limit: pageSize, offset: (page - 1) * pageSize }) as ListRow[];

  return {
    lists: rows.map((row) => toListRow(row, options.viewerId)),
    total,
    hasMore: page * pageSize < total,
  };
}

export function getReadingList(
  listId: string,
  viewerId: string | null,
): ReadingListDetail | null {
  const db = getDb();
  const row = db
    .prepare(
      `${LIST_SELECT}
       WHERE rl.id = @listId AND u.is_suspended = 0
         AND ${blockPair("@viewerId", "rl.owner_id")}`,
    )
    .get({ listId, viewerId: viewerId ?? "" }) as ListRow | undefined;
  if (!row) return null;

  const books = db
    .prepare(
      `SELECT i.book_id, b.title, b.author, b.cover_url, i.note,
              (SELECT COUNT(*) FROM book_comments c
                WHERE c.book_id = i.book_id AND c.status = 'visible') AS comments
       FROM reading_list_items i
       JOIN books b ON b.id = i.book_id
       WHERE i.list_id = ?
       ORDER BY i.added_at ASC`,
    )
    .all(listId) as {
    book_id: string;
    title: string;
    author: string;
    cover_url: string | null;
    note: string;
    comments: number;
  }[];

  return {
    ...toListRow(row, viewerId),
    books: books.map((book) => ({
      bookId: book.book_id,
      title: book.title,
      author: book.author,
      coverUrl: book.cover_url,
      note: book.note,
      comments: book.comments,
    })),
  };
}

export function addToList(userId: string, listId: string, bookId: string): void {
  const db = getDb();
  assertListOwner(db, listId, userId);
  if (!db.prepare("SELECT 1 FROM books WHERE id = ?").get(bookId)) {
    throw new ApiError(404, "Ese libro no existe.");
  }
  const count = (
    db.prepare("SELECT COUNT(*) AS value FROM reading_list_items WHERE list_id = ?").get(listId) as {
      value: number;
    }
  ).value;
  if (count >= 60) throw new ApiError(409, "Una lista admite hasta 60 libros.");
  db.prepare(
    "INSERT OR IGNORE INTO reading_list_items (list_id, book_id, note, added_at) VALUES (?, ?, '', ?)",
  ).run(listId, bookId, nowIso());
}

export function updateReadingList(
  userId: string,
  listId: string,
  input: { title: string; description: string; showOwner?: boolean },
): void {
  const db = getDb();
  assertListOwner(db, listId, userId);
  db.prepare(
    "UPDATE reading_lists SET title = ?, description = ?, show_owner = ? WHERE id = ?",
  ).run(input.title, input.description, input.showOwner ? 1 : 0, listId);
}

export function removeFromList(userId: string, listId: string, bookId: string): void {
  const db = getDb();
  assertListOwner(db, listId, userId);
  db.prepare("DELETE FROM reading_list_items WHERE list_id = ? AND book_id = ?").run(listId, bookId);
}

/** Listas propias que ya incluyen una obra (para marcar el selector). */
export function listIdsContainingBook(userId: string, bookId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT rl.id FROM reading_lists rl
       JOIN reading_list_items i ON i.list_id = rl.id
       WHERE rl.owner_id = ? AND i.book_id = ?`,
    )
    .all(userId, bookId) as { id: string }[];
  return rows.map((row) => row.id);
}

export function deleteReadingList(userId: string, listId: string): void {
  const db = getDb();
  assertListOwner(db, listId, userId);
  db.prepare("DELETE FROM reading_lists WHERE id = ?").run(listId);
}

/** Listas públicas para el sitemap (dueño activo). */
export function listReadingListSitemap(limit = 500): { id: string; created_at: string }[] {
  return getDb()
    .prepare(
      `SELECT rl.id, rl.created_at FROM reading_lists rl
         JOIN users u ON u.id = rl.owner_id
        WHERE u.is_suspended = 0
        ORDER BY rl.created_at DESC LIMIT ?`,
    )
    .all(limit) as { id: string; created_at: string }[];
}

