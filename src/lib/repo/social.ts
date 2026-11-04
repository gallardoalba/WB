import { getDb } from "../db";
import { ApiError } from "../errors";
import type { ActivityView, ConversationView, ReaderView } from "../domain";
import { blockPair, isBlocked, nowIso, userCity } from "./shared";
import { getUserById } from "./users";
import { notify } from "./notifications";
import {
  COMMENT_FILTER,
  COMMENT_SELECT,
  toConversationView,
  type CommentRow,
  type CommentViewer,
} from "./comments";

export function blockUser(blockerId: string, blockedId: string): void {
  if (blockerId === blockedId) throw new ApiError(409, "No puedes bloquearte a ti mismo.");
  if (!getUserById(blockedId)) throw new ApiError(404, "La persona no existe.");
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)",
    ).run(blockerId, blockedId, nowIso());
    // Un bloqueo también rompe el seguimiento en los dos sentidos.
    db.prepare(
      "DELETE FROM follows WHERE (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)",
    ).run(blockerId, blockedId, blockedId, blockerId);
  })();
}

export function unblockUser(blockerId: string, blockedId: string): void {
  getDb().prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(blockerId, blockedId);
}

/* ------------------------------ seguimiento ------------------------------- */

/** Contadores de seguimiento (solo cuentas activas). */
function followCounts(userId: string): { followers: number; following: number } {
  const db = getDb();
  const followers = (
    db
      .prepare(
        `SELECT COUNT(*) AS value FROM follows f
         JOIN users u ON u.id = f.follower_id
         WHERE f.followed_id = ? AND u.is_suspended = 0`,
      )
      .get(userId) as { value: number }
  ).value;
  const following = (
    db
      .prepare(
        `SELECT COUNT(*) AS value FROM follows f
         JOIN users u ON u.id = f.followed_id
         WHERE f.follower_id = ? AND u.is_suspended = 0`,
      )
      .get(userId) as { value: number }
  ).value;
  return { followers, following };
}

export function getFollowState(
  userId: string,
  viewerId: string | null,
): { followers: number; following: number; isFollowing: boolean } {
  const counts = followCounts(userId);
  if (!viewerId || viewerId === userId) return { ...counts, isFollowing: false };
  const row = getDb()
    .prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?")
    .get(viewerId, userId);
  return { ...counts, isFollowing: Boolean(row) };
}

export function setFollow(
  followerId: string,
  followedId: string,
  follow: boolean,
): { following: boolean; followers: number } {
  if (followerId === followedId) {
    throw new ApiError(409, "No puedes seguirte a ti mismo.");
  }
  const target = getUserById(followedId);
  if (!target || target.isSuspended) throw new ApiError(404, "La persona no existe.");
  if (isBlocked(followerId, followedId) || isBlocked(followedId, followerId)) {
    throw new ApiError(409, "No puedes seguir a esa persona.");
  }

  const db = getDb();
  let created = false;
  db.transaction(() => {
    if (follow) {
      const result = db
        .prepare(
          "INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)",
        )
        .run(followerId, followedId, nowIso());
      created = result.changes > 0;
      if (created) {
        const author = getUserById(followerId);
        notify({
          userId: followedId,
          type: "follow",
          title: `${author?.name ?? "Alguien"} empezó a seguirte`,
          body: "Verás sus novedades en la pestaña «Siguiendo» de la comunidad.",
          link: `/u/${followerId}`,
        });
      }
    } else {
      db.prepare("DELETE FROM follows WHERE follower_id = ? AND followed_id = ?").run(
        followerId,
        followedId,
      );
    }
  })();

  const { followers } = followCounts(followedId);
  return { following: follow, followers };
}

type ReaderRow = {
  id: string;
  name: string;
  city: string;
  bio: string;
  published: number;
  followers: number;
  is_following: number;
};

/** Directorio de lectores activos de la región, con búsqueda y filtro de ciudad. */
export function listReaders(options: {
  viewerId: string | null;
  city?: string | null;
  q?: string;
  sort?: "followers" | "near" | "active";
  page?: number;
  pageSize?: number;
}): { readers: ReaderView[]; total: number; hasMore: boolean } {
  const db = getDb();
  const pageSize = Math.min(Math.max(options.pageSize ?? 12, 1), 48);
  const page = Math.max(1, options.page ?? 1);
  const viewerId = options.viewerId ?? "";
  const city = options.city ?? null;
  const like = `%${(options.q ?? "").trim().replace(/[%_]/g, "")}%`;
  const viewerCity = options.viewerId ? (userCity(options.viewerId) ?? "") : "";
  const sort = options.sort ?? "followers";

  const where = `
    u.is_suspended = 0
    AND u.email NOT LIKE 'deleted-%'
    AND u.id <> @viewerId
    AND (
      EXISTS (SELECT 1 FROM listings l WHERE l.owner_id = u.id AND l.status <> 'removed')
      OR EXISTS (SELECT 1 FROM book_comments c WHERE c.author_id = u.id AND c.status = 'visible')
      OR EXISTS (SELECT 1 FROM club_members m WHERE m.user_id = u.id AND m.status = 'member')
    )
    AND (@city IS NULL OR u.city = @city)
    AND (@like = '%%' OR u.name LIKE @like COLLATE NOCASE)
    AND NOT EXISTS (
      SELECT 1 FROM blocks bl
      WHERE (bl.blocker_id = @viewerId AND bl.blocked_id = u.id)
         OR (bl.blocker_id = u.id AND bl.blocked_id = @viewerId)
    )
  `;

  const params = { viewerId, city, like, viewerCity };
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS value FROM users u WHERE ${where}`)
      .get(params) as { value: number }
  ).value;

  const withDistance = sort === "near" && Boolean(viewerCity);
  const distanceJoin = withDistance
    ? "LEFT JOIN city_distances rd ON rd.from_name = @viewerCity AND rd.to_name = u.city"
    : "";
  const distanceExpr = withDistance ? "rd.km" : "NULL";

  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.city, u.bio,
              (SELECT COUNT(*) FROM listings l
                WHERE l.owner_id = u.id AND l.status = 'available') AS published,
              (SELECT COUNT(*) FROM follows f WHERE f.followed_id = u.id) AS followers,
              CASE WHEN EXISTS (
                SELECT 1 FROM follows f2
                 WHERE f2.follower_id = @viewerId AND f2.followed_id = u.id
              ) THEN 1 ELSE 0 END AS is_following,
              ${distanceExpr} AS distance_km,
              (SELECT COUNT(DISTINCT mine.book_id)
                 FROM listings mine
                 JOIN listings theirs ON theirs.book_id = mine.book_id
                WHERE mine.owner_id = @viewerId AND mine.status <> 'removed'
                  AND theirs.owner_id = u.id AND theirs.status <> 'removed') AS shared_books,
              (SELECT COUNT(*) FROM club_members cm
                WHERE cm.user_id = u.id AND cm.status = 'member') AS clubs,
              (SELECT MAX(x) FROM (
                 SELECT MAX(l2.created_at) AS x FROM listings l2
                  WHERE l2.owner_id = u.id AND l2.status <> 'removed'
                 UNION ALL
                 SELECT MAX(c2.created_at) FROM book_comments c2
                  WHERE c2.author_id = u.id AND c2.status = 'visible'
                 UNION ALL
                 SELECT MAX(m2.joined_at) FROM club_members m2 WHERE m2.user_id = u.id
              )) AS last_active
       FROM users u
       ${distanceJoin}
       WHERE ${where}
       ORDER BY ${
         withDistance
           ? "CASE WHEN rd.km IS NULL THEN 1 ELSE 0 END, rd.km ASC, followers DESC"
           : sort === "active"
             ? "last_active DESC, followers DESC"
             : "followers DESC, published DESC, u.name COLLATE NOCASE ASC"
       }
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as {
    id: string;
    name: string;
    city: string;
    bio: string;
    published: number;
    followers: number;
    is_following: number;
    distance_km: number | null;
    shared_books: number;
    clubs: number;
    last_active: string | null;
  }[];

  return {
    readers: rows.map((row) => ({
      user: { id: row.id, name: row.name, city: row.city, bio: row.bio },
      published: row.published,
      followers: row.followers,
      isFollowing: Boolean(row.is_following),
      isMe: false,
      distanceKm: row.distance_km,
      sharedBooks: row.shared_books,
      clubs: row.clubs,
      lastActiveAt: row.last_active,
    })),
    total,
    hasMore: page * pageSize < total,
  };
}

/**
 * Personas que siguen a `userId` o a las que `userId` sigue, con la misma
 * información que el directorio para poder seguirlas desde ahí.
 */
export function listFollowEdges(
  userId: string,
  kind: "followers" | "following",
  viewerId: string | null,
): ReaderView[] {
  const viewer = viewerId ?? "";
  const rows =
    kind === "followers"
      ? (getDb()
          .prepare(
            `SELECT u.id, u.name, u.city, u.bio,
                    (SELECT COUNT(*) FROM listings l
                      WHERE l.owner_id = u.id AND l.status = 'available') AS published,
                    (SELECT COUNT(*) FROM follows f2 WHERE f2.followed_id = u.id) AS followers,
                    CASE WHEN EXISTS (
                      SELECT 1 FROM follows f3
                       WHERE f3.follower_id = @viewer AND f3.followed_id = u.id
                    ) THEN 1 ELSE 0 END AS is_following
             FROM follows f
             JOIN users u ON u.id = f.follower_id
             WHERE f.followed_id = @userId AND u.is_suspended = 0
               AND ${blockPair("@viewer", "u.id")}
             ORDER BY f.created_at DESC
             LIMIT 100`,
          )
          .all({ userId, viewer }) as ReaderRow[])
      : (getDb()
          .prepare(
            `SELECT u.id, u.name, u.city, u.bio,
                    (SELECT COUNT(*) FROM listings l
                      WHERE l.owner_id = u.id AND l.status = 'available') AS published,
                    (SELECT COUNT(*) FROM follows f2 WHERE f2.followed_id = u.id) AS followers,
                    CASE WHEN EXISTS (
                      SELECT 1 FROM follows f3
                       WHERE f3.follower_id = @viewer AND f3.followed_id = u.id
                    ) THEN 1 ELSE 0 END AS is_following
             FROM follows f
             JOIN users u ON u.id = f.followed_id
             WHERE f.follower_id = @userId AND u.is_suspended = 0
               AND ${blockPair("@viewer", "u.id")}
             ORDER BY f.created_at DESC
             LIMIT 100`,
          )
          .all({ userId, viewer }) as ReaderRow[]);

  return rows.map((row) => ({
    user: { id: row.id, name: row.name, city: row.city, bio: row.bio },
    published: row.published,
    followers: row.followers,
    isFollowing: Boolean(row.is_following),
    isMe: row.id === viewerId,
    distanceKm: null,
    sharedBooks: 0,
    clubs: 0,
    lastActiveAt: null,
  }));
}

/** Actividad reciente de las cuentas que sigue una persona. */
export function listFollowingActivity(viewerId: string, limit = 8): ActivityView[] {
  const rows = getDb()
    .prepare(
      `SELECT e.id, e.type, e.created_at, e.listing_id, u.name AS actor, b.title
       FROM events e
       JOIN users u ON u.id = e.actor_id
       JOIN listings l ON l.id = e.listing_id
       JOIN books b ON b.id = l.book_id
       WHERE l.status <> 'removed' AND u.is_suspended = 0
         AND e.actor_id IN (SELECT followed_id FROM follows WHERE follower_id = @viewerId)
       ORDER BY e.created_at DESC, e.rowid DESC
       LIMIT @take`,
    )
    .all({ viewerId, take: Math.min(Math.max(limit, 1), 30) }) as {
    id: string;
    type: ActivityView["type"];
    created_at: string;
    listing_id: string;
    actor: string;
    title: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    actor: row.actor,
    title: row.title,
    listingId: row.listing_id,
    createdAt: row.created_at,
  }));
}

/** Comentarios recientes de las cuentas que sigue una persona. */
export function listFollowingComments(viewerId: string, limit = 4): ConversationView[] {
  const rows = getDb()
    .prepare(
      `${COMMENT_SELECT}
       WHERE c.parent_id IS NULL AND c.status = 'visible' AND ${COMMENT_FILTER}
         AND c.author_id IN (SELECT followed_id FROM follows WHERE follower_id = @viewerId)
       ORDER BY c.created_at DESC, c.rowid DESC
       LIMIT @take`,
    )
    .all({ viewerId, take: Math.min(Math.max(limit, 1), 20) }) as CommentRow[];

  return rows.map(toConversationView);
}

/** Muro del perfil: actividad propia. */
export function listUserActivity(userId: string, limit = 8): ActivityView[] {
  const rows = getDb()
    .prepare(
      `SELECT e.id, e.type, e.created_at, e.listing_id, u.name AS actor, b.title
       FROM events e
       JOIN users u ON u.id = e.actor_id
       JOIN listings l ON l.id = e.listing_id
       JOIN books b ON b.id = l.book_id
       WHERE e.actor_id = ? AND l.status <> 'removed' AND u.is_suspended = 0
       ORDER BY e.created_at DESC, e.rowid DESC
       LIMIT ?`,
    )
    .all(userId, Math.min(Math.max(limit, 1), 30)) as {
    id: string;
    type: ActivityView["type"];
    created_at: string;
    listing_id: string;
    actor: string;
    title: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    actor: row.actor,
    title: row.title,
    listingId: row.listing_id,
    createdAt: row.created_at,
  }));
}

/** Muro del perfil: comentarios publicados por una cuenta. */
export function listAuthorComments(
  userId: string,
  viewer: CommentViewer,
  limit = 10,
): ConversationView[] {
  const viewerId = viewer?.id ?? "";
  const rows = getDb()
    .prepare(
      `${COMMENT_SELECT}
       WHERE c.parent_id IS NULL AND c.status <> 'hidden' AND ${COMMENT_FILTER}
         AND c.author_id = @authorId
       ORDER BY c.created_at DESC, c.rowid DESC
       LIMIT @take`,
    )
    .all({ viewerId, authorId: userId, take: Math.min(Math.max(limit, 1), 40) }) as CommentRow[];

  return rows.map(toConversationView);
}

