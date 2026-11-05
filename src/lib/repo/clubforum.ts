import { randomUUID } from "node:crypto";
import { getDb, type Db } from "../db";
import { ApiError } from "../errors";
import type { ClubPostReportView, ClubPostView } from "../domain";
import { notify } from "./notifications";
import { writeAudit } from "./moderation";
import { blockPair, isBlocked, nowIso } from "./shared";
import { moderatesClub } from "./clubs";
import { assertVerified } from "./users";

/* --------------------------- foro de los clubes ---------------------------- */

/**
 * Tablón de cada club de lectura.
 *
 * Hasta la v32 la conversación del club era la del libro en curso, pública y
 * compartida con toda la plataforma. El foro es lo contrario: **solo lo leen
 * los miembros**, así que la pertenencia se comprueba en cada consulta, no en
 * el cliente. No hay mensajes privados: todo lo que se escribe aquí lo ve el
 * club entero.
 *
 * Un solo nivel de respuestas, igual que en el hilo de una obra: mantiene la
 * conversación legible y permite reutilizar la misma moderación (`status`).
 */

type ClubRow = { id: string; name: string; owner_id: string };

type PostRow = {
  id: string;
  club_id: string;
  parent_id: string | null;
  body: string;
  status: string;
  created_at: string;
  author_id: string;
  author_name: string;
  author_city: string;
  likes: number;
  liked: number;
};

/** El club tiene que existir y estar visible; si no, 404 (no se filtra nada). */
function visibleClub(db: Db, clubId: string): ClubRow {
  const club = db
    .prepare("SELECT id, name, owner_id FROM clubs WHERE id = ? AND status = 'visible'")
    .get(clubId) as ClubRow | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");
  return club;
}

/** Quien creó el club cuenta como miembro aunque falte la fila. */
function isMember(db: Db, club: ClubRow, userId: string): boolean {
  if (club.owner_id === userId) return true;
  return Boolean(
    db
      .prepare("SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'member'")
      .get(club.id, userId),
  );
}

function assertMember(db: Db, club: ClubRow, userId: string): void {
  if (!isMember(db, club, userId)) {
    throw new ApiError(403, "El foro del club es solo para sus miembros.");
  }
}

function assertActive(db: Db, userId: string): void {
  const row = db.prepare("SELECT is_suspended FROM users WHERE id = ?").get(userId) as
    | { is_suspended: number }
    | undefined;
  if (!row || row.is_suspended) {
    throw new ApiError(403, "Tu cuenta no puede escribir en el foro ahora mismo.");
  }
}

/**
 * Qué se ve de un mensaje: los ocultos por moderación solo los ve su autor y
 * los de cuentas suspendidas no aparecen. Los bloqueos se filtran en SQL.
 */
const POST_FILTER = `
  (u.is_suspended = 0 OR p.status = 'deleted')
  AND (p.status <> 'hidden' OR p.author_id = @viewerId)
  AND ${blockPair("@viewerId", "p.author_id")}
`;

const POST_SELECT = `
  SELECT p.id, p.club_id, p.parent_id, p.body, p.status, p.created_at, p.author_id,
         u.name AS author_name, u.city AS author_city,
         (SELECT COUNT(*) FROM club_post_likes pl WHERE pl.post_id = p.id) AS likes,
         CASE WHEN EXISTS (
           SELECT 1 FROM club_post_likes pl
            WHERE pl.post_id = p.id AND pl.user_id = @viewerId
         ) THEN 1 ELSE 0 END AS liked
    FROM club_posts p
    JOIN users u ON u.id = p.author_id
`;

function toPostView(row: PostRow, viewerId: string, canModerate: boolean): ClubPostView {
  const deleted = row.status === "deleted";
  return {
    id: row.id,
    // Un mensaje borrado conserva el hueco del hilo, nunca el texto.
    body: deleted ? "" : row.body,
    deleted,
    hidden: row.status === "hidden",
    createdAt: row.created_at,
    author: { id: row.author_id, name: row.author_name, city: row.author_city },
    likes: row.likes,
    likedByMe: Boolean(row.liked) && Boolean(viewerId),
    isMine: row.author_id === viewerId,
    canDelete: !deleted && (row.author_id === viewerId || canModerate),
    replies: [],
  };
}

export type ClubForumPage = { posts: ClubPostView[]; hasMore: boolean; total: number };

/**
 * Hilo del club, paginado por cursor (`beforeId` = último mensaje raíz visto).
 * Devuelve cada mensaje raíz con sus respuestas.
 */
export function listClubPosts(
  clubId: string,
  viewer: { id: string; isAdmin: boolean } | null,
  options: { beforeId?: string | null; limit?: number } = {},
): ClubForumPage {
  const db = getDb();
  if (!viewer) throw new ApiError(401, "Entra en tu cuenta para leer el foro del club.");
  const club = visibleClub(db, clubId);
  assertMember(db, club, viewer.id);

  const viewerId = viewer.id;
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 30);
  // Quien creó el club puede retirar cualquier mensaje del tablón.
  // Moderar el tablón no es solo cosa de quien creó el club: sus moderadores
  // también retiran mensajes.
  const canModerate = viewer.isAdmin || moderatesClub(club.id, viewerId);

  let cursor = Number.MAX_SAFE_INTEGER;
  if (options.beforeId) {
    const anchor = db
      .prepare("SELECT rowid AS rid FROM club_posts WHERE id = ? AND club_id = ? AND parent_id IS NULL")
      .get(options.beforeId, clubId) as { rid: number } | undefined;
    if (!anchor) throw new ApiError(404, "Ese mensaje ya no está disponible.");
    cursor = anchor.rid;
  }

  const rows = db
    .prepare(
      `${POST_SELECT}
        WHERE p.club_id = @clubId AND p.parent_id IS NULL AND p.rowid < @cursor
          AND ${POST_FILTER}
        ORDER BY p.created_at DESC, p.rowid DESC
        LIMIT @take`,
    )
    .all({ clubId, cursor, viewerId, take: limit + 1 }) as PostRow[];

  const page = rows.slice(0, limit);
  const repliesByRoot = new Map<string, ClubPostView[]>();

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
        `${POST_SELECT}
          WHERE p.parent_id IN (${placeholders}) AND ${POST_FILTER}
          ORDER BY p.created_at ASC, p.rowid ASC
          LIMIT 200`,
      )
      .all(params) as PostRow[];
    for (const row of replies) {
      const key = row.parent_id ?? "";
      const list = repliesByRoot.get(key) ?? [];
      list.push(toPostView(row, viewerId, canModerate));
      repliesByRoot.set(key, list);
    }
  }

  // El total cuenta lo que ve el club (raíces y respuestas visibles), sin los
  // mensajes ocultos ni los de cuentas suspendidas: así el número no baila.
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS value FROM club_posts p
           JOIN users u ON u.id = p.author_id
          WHERE p.club_id = @clubId AND p.status = 'visible' AND u.is_suspended = 0
            AND ${blockPair("@viewerId", "p.author_id")}`,
      )
      .get({ clubId, viewerId }) as { value: number }
  ).value;

  return {
    posts: page.map((row) => ({
      ...toPostView(row, viewerId, canModerate),
      replies: repliesByRoot.get(row.id) ?? [],
    })),
    hasMore: rows.length > limit,
    total,
  };
}

/** Cuántos mensajes tiene el club (solo para quien puede entrar). */
export function countClubPosts(clubId: string, viewerId: string): number {
  return listClubPosts(clubId, { id: viewerId, isAdmin: false }, { limit: 1 }).total;
}

/**
 * Un mensaje del club nunca bombardea: como mucho se avisa a cada miembro una
 * vez cada 20 horas por club, y quien escribe no se avisa a sí mismo.
 */
const NOTICE_WINDOW = "-20 hours";

function notifiedRecently(db: Db, userId: string, clubId: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM product_events
          WHERE type = 'club_post_notice' AND user_id = ? AND club_id = ?
            AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now',?)`,
      )
      .get(userId, clubId, NOTICE_WINDOW),
  );
}

function markNotified(db: Db, userId: string, clubId: string): void {
  db.prepare(
    "INSERT INTO product_events (id, type, user_id, club_id, created_at) VALUES (?, 'club_post_notice', ?, ?, ?)",
  ).run(`evt_${randomUUID()}`, userId, clubId, nowIso());
}

function announce(db: Db, club: ClubRow, authorId: string, authorName: string, body: string): void {
  const members = db
    .prepare(
      `SELECT m.user_id FROM club_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.club_id = ? AND m.status = 'member'
          AND u.is_suspended = 0 AND m.user_id <> ?`,
    )
    .all(club.id, authorId) as { user_id: string }[];
  const excerpt = body.length > 90 ? `${body.slice(0, 89)}…` : body;
  for (const member of members) {
    if (notifiedRecently(db, member.user_id, club.id)) continue;
    if (isBlocked(authorId, member.user_id) || isBlocked(member.user_id, authorId)) continue;
    notify({
      userId: member.user_id,
      type: "club",
      title: "Nueva conversación en tu club",
      body: `«${club.name}»: ${excerpt}`,
      link: `/clubes/${club.id}#foro`,
    });
    markNotified(db, member.user_id, club.id);
  }
}

/** Publica en el foro. `parentId` responde a un mensaje de primer nivel. */
export function createClubPost(input: {
  clubId: string;
  authorId: string;
  body: string;
  authorName?: string;
  parentId?: string | null;
}): ClubPostView {
  const db = getDb();
  const club = visibleClub(db, input.clubId);
  assertMember(db, club, input.authorId);
  assertActive(db, input.authorId);
  // Publicar en comunidad exige cuenta confirmada, igual que comentar un libro.
  assertVerified(input.authorId);

  let parent: { id: string; author_id: string; status: string } | undefined;
  if (input.parentId) {
    const row = db
      .prepare("SELECT id, author_id, club_id, parent_id, status FROM club_posts WHERE id = ?")
      .get(input.parentId) as
      | { id: string; author_id: string; club_id: string; parent_id: string | null; status: string }
      | undefined;
    if (!row || row.club_id !== input.clubId) throw new ApiError(404, "Ese mensaje no existe.");
    if (row.parent_id !== null) {
      throw new ApiError(409, "Solo se puede responder al mensaje principal.");
    }
    if (row.status !== "visible") throw new ApiError(409, "Ese mensaje ya no admite respuestas.");
    if (isBlocked(input.authorId, row.author_id) || isBlocked(row.author_id, input.authorId)) {
      throw new ApiError(403, "No puedes responder a ese mensaje.");
    }
    parent = row;
  }

  const authorName =
    input.authorName ??
    ((
      db.prepare("SELECT name FROM users WHERE id = ?").get(input.authorId) as
        | { name: string }
        | undefined
    )?.name ??
      "Alguien");

  const id = `cpost_${randomUUID()}`;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO club_posts (id, club_id, author_id, parent_id, body, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'visible', ?)`,
    ).run(id, input.clubId, input.authorId, parent?.id ?? null, input.body, nowIso());

    if (parent) {
      // Responder avisa solo a quien escribió: el resto del club ya tiene el
      // aviso del mensaje inicial.
      if (parent.author_id !== input.authorId) {
        notify({
          userId: parent.author_id,
          type: "club",
          title: `${authorName} respondió a tu mensaje`,
          body: `«${club.name}»: ${input.body.length > 90 ? `${input.body.slice(0, 89)}…` : input.body}`,
          link: `/clubes/${club.id}#c-${id}`,
        });
      }
    } else {
      announce(db, club, input.authorId, authorName, input.body);
    }
  })();

  const row = db
    .prepare(`${POST_SELECT} WHERE p.id = @id`)
    .get({ id, viewerId: input.authorId }) as PostRow;
  return toPostView(row, input.authorId, club.owner_id === input.authorId);
}

/**
 * Borra un mensaje. Puede quien lo escribió, quien creó el club, sus
 * moderadores y la administración; si tiene respuestas se conserva el hueco del
 * hilo.
 */
export function deleteClubPost(postId: string, actor: { id: string; isAdmin: boolean }): void {
  const db = getDb();
  const row = db
    .prepare("SELECT id, club_id, author_id, status FROM club_posts WHERE id = ?")
    .get(postId) as { id: string; club_id: string; author_id: string; status: string } | undefined;
  if (!row) throw new ApiError(404, "El mensaje no existe.");

  const club = db.prepare("SELECT owner_id FROM clubs WHERE id = ?").get(row.club_id) as
    | { owner_id: string }
    | undefined;
  const allowed =
    row.author_id === actor.id ||
    actor.isAdmin ||
    club?.owner_id === actor.id ||
    moderatesClub(row.club_id, actor.id);
  if (!allowed) throw new ApiError(403, "Solo puedes borrar tus propios mensajes.");

  const replies = db
    .prepare("SELECT COUNT(*) AS value FROM club_posts WHERE parent_id = ? AND status <> 'deleted'")
    .get(postId) as { value: number };

  db.transaction(() => {
    if (replies.value > 0) {
      db.prepare("UPDATE club_posts SET status = 'deleted', body = '' WHERE id = ?").run(postId);
    } else {
      db.prepare("DELETE FROM club_posts WHERE id = ?").run(postId);
    }
    // La denuncia deja de tener sentido en cuanto el mensaje desaparece: si no,
    // el panel de administración seguiría enseñando denuncias de mensajes que
    // ya no existen.
    db.prepare(
      "UPDATE reports SET status = 'resolved' WHERE target_type = 'club_post' AND target_id = ? AND status = 'open'",
    ).run(postId);
    if (actor.isAdmin && row.author_id !== actor.id) {
      writeAudit(db, actor.id, "delete_club_post", "club_post", postId, "borrado desde el panel");
    }
  })();
}

/**
 * Denuncias abiertas sobre los mensajes de **este** club.
 *
 * Es la vista de moderación del propio club: hasta ahora la única forma de
 * enterarse de que alguien había denunciado un mensaje era el panel de
 * administración, así que para quien modera el club la moderación «no existía».
 * Solo la ven su dueño y sus moderadores, y se comprueba contra la base.
 */
export function listClubPostReports(clubId: string, viewerId: string): ClubPostReportView[] {
  const db = getDb();
  const club = visibleClub(db, clubId);
  if (!moderatesClub(club.id, viewerId)) {
    throw new ApiError(403, "Solo quien lleva el club ve los mensajes denunciados.");
  }
  const rows = db
    .prepare(
      `SELECT r.id, r.reason, r.details, r.created_at,
              rep.id AS reporter_id, rep.name AS reporter_name,
              p.id AS post_id, p.body AS post_body, p.status AS post_status,
              au.name AS post_author
         FROM reports r
         JOIN club_posts p ON p.id = r.target_id AND p.club_id = @clubId
         LEFT JOIN users rep ON rep.id = r.reporter_id
         LEFT JOIN users au ON au.id = p.author_id
        WHERE r.target_type = 'club_post' AND r.status = 'open'
          AND ${blockPair("@viewerId", "p.author_id")}
        ORDER BY r.created_at DESC
        LIMIT 50`,
    )
    .all({ clubId, viewerId }) as {
    id: string;
    reason: string;
    details: string;
    created_at: string;
    reporter_id: string | null;
    reporter_name: string | null;
    post_id: string;
    post_body: string;
    post_status: string;
    post_author: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    details: row.details,
    createdAt: row.created_at,
    reporter: { id: row.reporter_id ?? "", name: row.reporter_name ?? "—" },
    post: {
      id: row.post_id,
      body: row.post_body,
      author: row.post_author ?? "—",
      status: row.post_status,
    },
  }));
}

/** Me gusta dentro del club: solo miembros, y nunca al propio mensaje. */
export function setClubPostLike(
  userId: string,
  clubId: string,
  postId: string,
  liked: boolean,
): { likes: number; likedByMe: boolean } {
  const db = getDb();
  const club = visibleClub(db, clubId);
  assertMember(db, club, userId);

  const row = db
    .prepare("SELECT author_id, status FROM club_posts WHERE id = ? AND club_id = ?")
    .get(postId, clubId) as { author_id: string; status: string } | undefined;
  if (!row || row.status !== "visible") throw new ApiError(404, "El mensaje no existe.");
  if (row.author_id === userId) {
    throw new ApiError(409, "No puedes dar me gusta a tu propio mensaje.");
  }

  if (liked) {
    db.prepare(
      "INSERT OR IGNORE INTO club_post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)",
    ).run(postId, userId, nowIso());
  } else {
    db.prepare("DELETE FROM club_post_likes WHERE post_id = ? AND user_id = ?").run(postId, userId);
  }

  const value = (
    db.prepare("SELECT COUNT(*) AS value FROM club_post_likes WHERE post_id = ?").get(postId) as {
      value: number;
    }
  ).value;
  return { likes: value, likedByMe: liked };
}
