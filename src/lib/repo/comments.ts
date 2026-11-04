import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { ApiError } from "../errors";
import type { BookCommentView, ConversationView } from "../domain";
import { blockPair, isBlocked, nowIso } from "./shared";
import { assertVerified, getUserById } from "./users";
import { notify } from "./notifications";
import { writeAudit } from "./moderation";

/**
 * Los comentarios cuelgan de la **obra** (`books`), no del ejemplar: así la
 * conversación sobre un título se comparte entre todas sus copias y sobrevive a
 * que el libro cambie de manos.
 */

export type CommentRow = {
  id: string;
  book_id: string;
  book_title: string;
  body: string;
  spoiler: number;
  status: "visible" | "hidden" | "deleted";
  created_at: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  author_city: string;
  likes: number;
  liked: number;
  reply_count: number;
};

/** Quien mira el hilo: `null` en visitas anónimas. */
export type CommentViewer = { id: string; isAdmin: boolean } | null;

/**
 * Visibilidad de un comentario: los ocultos por moderación solo los ve su autor
 * (que así entiende por qué no aparece) y los de cuentas suspendidas no se
 * muestran. Los bloqueos se filtran en SQL, nunca en el cliente.
 */
export const COMMENT_FILTER = `
  (u.is_suspended = 0 OR c.status = 'deleted')
  AND (c.status <> 'hidden' OR c.author_id = @viewerId)
  AND NOT EXISTS (
    SELECT 1 FROM blocks bl
    WHERE (bl.blocker_id = @viewerId AND bl.blocked_id = c.author_id)
       OR (bl.blocker_id = c.author_id AND bl.blocked_id = @viewerId)
  )
`;

export const COMMENT_SELECT = `
  SELECT c.id, c.book_id, bk.title AS book_title, c.body, c.spoiler, c.status,
         c.created_at, c.parent_id, c.author_id,
         u.name AS author_name, u.city AS author_city,
         (SELECT COUNT(*) FROM book_comment_likes kl WHERE kl.comment_id = c.id) AS likes,
         CASE WHEN EXISTS (
           SELECT 1 FROM book_comment_likes kl
            WHERE kl.comment_id = c.id AND kl.user_id = @viewerId
         ) THEN 1 ELSE 0 END AS liked,
         (SELECT COUNT(*) FROM book_comments r
           WHERE r.parent_id = c.id AND r.status = 'visible') AS reply_count
  FROM book_comments c
  JOIN books bk ON bk.id = c.book_id
  JOIN users u ON u.id = c.author_id
`;

function toCommentView(row: CommentRow, viewerId: string, isAdmin: boolean): BookCommentView {
  const deleted = row.status === "deleted";
  return {
    id: row.id,
    // Un comentario eliminado conserva el hueco del hilo, no el texto. Un
    // spoiler tampoco viaja: su texto se pide al pulsar «leerlo».
    body: deleted || row.spoiler ? "" : row.body,
    spoiler: Boolean(row.spoiler),
    hidden: row.status === "hidden",
    deleted,
    likes: row.likes,
    likedByMe: Boolean(row.liked) && Boolean(viewerId),
    isMine: row.author_id === viewerId,
    canDelete: !deleted && (row.author_id === viewerId || isAdmin),
    createdAt: row.created_at,
    author: { id: row.author_id, name: row.author_name, city: row.author_city },
    replies: [],
  };
}

export function commentExcerpt(body: string, max = 90): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Hilo de una obra, paginado por cursor (`beforeId` = último comentario raíz visto). */
export function listBookComments(
  bookId: string,
  viewer: CommentViewer,
  options: { beforeId?: string | null; limit?: number } = {},
): { comments: BookCommentView[]; hasMore: boolean; total: number } {
  const db = getDb();
  const viewerId = viewer?.id ?? "";
  const isAdmin = Boolean(viewer?.isAdmin);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 30);

  if (!db.prepare("SELECT 1 FROM books WHERE id = ?").get(bookId)) {
    throw new ApiError(404, "Ese libro no existe.");
  }

  let cursor = Number.MAX_SAFE_INTEGER;
  if (options.beforeId) {
    const anchor = db
      .prepare(
        "SELECT rowid AS rid FROM book_comments WHERE id = ? AND book_id = ? AND parent_id IS NULL",
      )
      .get(options.beforeId, bookId) as { rid: number } | undefined;
    if (!anchor) throw new ApiError(404, "El comentario ya no está disponible.");
    cursor = anchor.rid;
  }

  const rows = db
    .prepare(
      `${COMMENT_SELECT}
       WHERE c.book_id = @bookId AND c.parent_id IS NULL AND c.rowid < @cursor
         AND ${COMMENT_FILTER}
       ORDER BY c.created_at DESC, c.rowid DESC
       LIMIT @take`,
    )
    .all({ bookId, cursor, viewerId, take: limit + 1 }) as CommentRow[];

  const page = rows.slice(0, limit);
  const repliesByRoot = new Map<string, BookCommentView[]>();

  if (page.length > 0) {
    const params: Record<string, string | number> = { viewerId };
    const placeholders = page
      .map((row, index) => {
        params[`root${index}`] = row.id;
        return `@root${index}`;
      })
      .join(",");
    const replies = db
      .prepare(
        `${COMMENT_SELECT}
         WHERE c.parent_id IN (${placeholders}) AND ${COMMENT_FILTER}
         ORDER BY c.created_at ASC, c.rowid ASC
         LIMIT 200`,
      )
      .all(params) as CommentRow[];

    for (const row of replies) {
      const key = row.parent_id ?? "";
      const list = repliesByRoot.get(key) ?? [];
      list.push(toCommentView(row, viewerId, isAdmin));
      repliesByRoot.set(key, list);
    }
  }

  // `total` cuenta mensajes visibles (raíces y respuestas): la misma cifra que
  // `countBookComments` enseña en la ficha. Los ocultos que ve su autor no
  // entran en el total para que las dos cifras no diverjan.
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS value FROM book_comments c
         JOIN users u ON u.id = c.author_id
         WHERE c.book_id = @bookId
           AND c.status = 'visible' AND u.is_suspended = 0
           AND ${blockPair("@viewerId", "c.author_id")}`,
      )
      .get({ bookId, viewerId }) as { value: number }
  ).value;

  return {
    comments: page.map((row) => ({
      ...toCommentView(row, viewerId, isAdmin),
      replies: repliesByRoot.get(row.id) ?? [],
    })),
    hasMore: rows.length > limit,
    total,
  };
}

/**
 * Texto de un comentario con spoiler, que no se envía en el hilo para no
 * descubrirlo en el código fuente. Respeta visibilidad y bloqueos.
 */
export function getCommentBody(commentId: string, viewerId: string | null): string {
  const viewer = viewerId ?? "";
  const row = getDb()
    .prepare(
      `SELECT c.body, c.status, c.author_id, c.spoiler
       FROM book_comments c JOIN users u ON u.id = c.author_id
       WHERE c.id = @id AND u.is_suspended = 0
         AND (c.status <> 'hidden' OR c.author_id = @viewer)
         AND ${blockPair("@viewer", "c.author_id")}`,
    )
    .get({ id: commentId, viewer }) as
    | { body: string; status: string; author_id: string; spoiler: number }
    | undefined;

  if (!row || row.status === "deleted") throw new ApiError(404, "El comentario no existe.");
  return row.body;
}

/** Mensajes visibles de una obra (raíces y respuestas). */
/**
 * Comentarios visibles de una obra (raíces y respuestas), con la misma regla
 * que `listBookComments`: sin cuentas suspendidas, sin ocultos ajenos y sin
 * bloqueos entre quien mira y quien escribió.
 */
export function countBookComments(bookId: string, viewerId: string | null = null): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS value FROM book_comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.book_id = @bookId AND c.status <> 'deleted' AND ${COMMENT_FILTER}`,
    )
    .get({ bookId, viewerId: viewerId ?? "" }) as { value: number };
  return row.value;
}

/**
 * Comentarios raíz que esa persona suma en su perfil. Usa exactamente el
 * filtro de `listAuthorComments` para que el número de la cabecera y la lista
 * no diverjan.
 */
export function countAuthorComments(authorId: string, viewer: CommentViewer): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS value
         FROM book_comments c JOIN users u ON u.id = c.author_id
        WHERE c.parent_id IS NULL AND c.author_id = @authorId AND ${COMMENT_FILTER}`,
    )
    .get({ authorId, viewerId: viewer?.id ?? "" }) as { value: number };
  return row.value;
}

export function createBookComment(input: {
  bookId: string;
  authorId: string;
  body: string;
  spoiler: boolean;
  parentId?: string | null;
}): BookCommentView {
  const db = getDb();
  const book = db.prepare("SELECT id, title FROM books WHERE id = ?").get(input.bookId) as
    | { id: string; title: string }
    | undefined;
  if (!book) throw new ApiError(404, "Ese libro no existe.");

  const author = getUserById(input.authorId);
  if (!author || author.isSuspended) {
    throw new ApiError(403, "Tu cuenta no puede comentar ahora mismo.");
  }
  assertVerified(input.authorId);

  let parent: { id: string; author_id: string } | undefined;
  if (input.parentId) {
    const row = db
      .prepare("SELECT id, author_id, book_id, parent_id, status FROM book_comments WHERE id = ?")
      .get(input.parentId) as
      | { id: string; author_id: string; book_id: string; parent_id: string | null; status: string }
      | undefined;
    if (!row || row.book_id !== input.bookId) {
      throw new ApiError(404, "El comentario no existe.");
    }
    // Un solo nivel de respuestas: mantiene el hilo legible y evita anidar sin fin.
    if (row.parent_id !== null) {
      throw new ApiError(409, "Solo se puede responder al comentario principal.");
    }
    if (row.status !== "visible") {
      throw new ApiError(409, "Ese comentario ya no admite respuestas.");
    }
    if (isBlocked(input.authorId, row.author_id) || isBlocked(row.author_id, input.authorId)) {
      throw new ApiError(403, "No puedes responder a ese comentario.");
    }
    parent = row;
  }

  const id = `cmt_${randomUUID()}`;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO book_comments (id, book_id, author_id, parent_id, body, spoiler, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'visible', ?)`,
    ).run(
      id,
      input.bookId,
      input.authorId,
      parent?.id ?? null,
      input.body,
      input.spoiler ? 1 : 0,
      nowIso(),
    );

    // Solo se avisa al autor del comentario respondido: hablar de un libro no
    // debe generar ruido a nadie más.
    if (parent && parent.author_id !== input.authorId) {
      notify({
        userId: parent.author_id,
        type: "comment",
        title: `${author.name} respondió a tu comentario`,
        body: `«${book.title}»: ${commentExcerpt(input.body)}`,
        bookId: book.id,
        link: `/obra/${book.id}#c-${id}`,
      });
    }
  })();

  const row = db
    .prepare(`${COMMENT_SELECT} WHERE c.id = @id`)
    .get({ id, viewerId: input.authorId }) as CommentRow;
  return toCommentView(row, input.authorId, false);
}

/** Borra el propio comentario (o cualquiera, si es administración). */
export function deleteBookComment(
  commentId: string,
  actor: { id: string; isAdmin: boolean },
): void {
  const db = getDb();
  const row = db
    .prepare("SELECT id, author_id, status FROM book_comments WHERE id = ?")
    .get(commentId) as { id: string; author_id: string; status: string } | undefined;
  if (!row) throw new ApiError(404, "El comentario no existe.");
  if (row.author_id !== actor.id && !actor.isAdmin) {
    throw new ApiError(403, "Solo puedes borrar tus propios comentarios.");
  }

  const replies = db
    .prepare("SELECT COUNT(*) AS value FROM book_comments WHERE parent_id = ? AND status <> 'deleted'")
    .get(commentId) as { value: number };

  db.transaction(() => {
    if (replies.value > 0) {
      // Con respuestas se conserva el hueco para no romper la conversación.
      db.prepare("UPDATE book_comments SET status = 'deleted', body = '' WHERE id = ?").run(commentId);
    } else {
      db.prepare("DELETE FROM book_comments WHERE id = ?").run(commentId);
    }
    // El borrado desde el panel también deja rastro en la auditoría.
    if (actor.isAdmin && row.author_id !== actor.id) {
      writeAudit(db, actor.id, "delete_comment", "comment", commentId, "borrado desde el panel");
    }
  })();
}

export function setCommentLike(
  userId: string,
  commentId: string,
  liked: boolean,
): { likes: number; likedByMe: boolean } {
  const db = getDb();
  const row = db
    .prepare("SELECT author_id, status FROM book_comments WHERE id = ?")
    .get(commentId) as { author_id: string; status: string } | undefined;
  if (!row || row.status !== "visible") throw new ApiError(404, "El comentario no existe.");
  if (row.author_id === userId) {
    throw new ApiError(409, "No puedes dar me gusta a tu propio comentario.");
  }

  if (liked) {
    db.prepare(
      "INSERT OR IGNORE INTO book_comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)",
    ).run(commentId, userId, nowIso());
  } else {
    db.prepare("DELETE FROM book_comment_likes WHERE comment_id = ? AND user_id = ?").run(
      commentId,
      userId,
    );
  }

  const value = (
    db
      .prepare("SELECT COUNT(*) AS value FROM book_comment_likes WHERE comment_id = ?")
      .get(commentId) as { value: number }
  ).value;
  return { likes: value, likedByMe: liked };
}

export function toConversationView(row: CommentRow): ConversationView {
  return {
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    // El texto de un spoiler nunca sale del hilo: el muro solo muestra el aviso.
    excerpt: row.spoiler
      ? "Comentario con spoiler: ábrelo en la conversación de la obra."
      : commentExcerpt(row.body, 180),
    replies: row.reply_count,
    likes: row.likes,
    createdAt: row.created_at,
    author: { id: row.author_id, name: row.author_name, city: row.author_city },
  };
}

/** Últimas conversaciones abiertas, para la sección Comunidad. */
export function listRecentComments(
  limit = 4,
  viewer: CommentViewer = null,
  city: string | null = null,
): ConversationView[] {
  const viewerId = viewer?.id ?? "";
  const rows = getDb()
    .prepare(
      `${COMMENT_SELECT}
       WHERE c.parent_id IS NULL AND c.status = 'visible' AND ${COMMENT_FILTER}
         AND (@city IS NULL OR u.city = @city)
       ORDER BY c.created_at DESC, c.rowid DESC
       LIMIT @take`,
    )
    .all({ viewerId, city, take: Math.min(Math.max(limit, 1), 20) }) as CommentRow[];

  return rows.map(toConversationView);
}

