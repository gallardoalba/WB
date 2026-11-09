import { getDb } from "../db";
import type { PublicProfile, PublicUser } from "../domain";
import {
  blockPair,
  distanceParts,
  isBlocked,
  listingSelect,
  toListingView,
  type ListingRow,
} from "./shared";
import { getUserById } from "./users";
import { getFollowState } from "./social";
import { countAuthorComments } from "./comments";

/* --------------------------------- perfil --------------------------------- */

const PROFILE_PAGE_SIZE = 12;

/** Ejemplares publicados por la cuenta (los retirados no cuentan). */
export function countOwnListings(userId: string): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS count FROM listings WHERE owner_id = ? AND status <> 'removed'")
      .get(userId) as { count: number }
  ).count;
}

export function getPublicProfile(
  userId: string,
  viewerId: string | null,
  options: { page?: number; pageSize?: number } = {},
): PublicProfile | null {
  const user = getUserById(userId);
  if (!user) return null;
  // Una cuenta suspendida o eliminada deja de tener perfil público.
  if (user.isSuspended) return null;
  const db = getDb();
  const distance = distanceParts(viewerId);
  const pageSize = options.pageSize ?? PROFILE_PAGE_SIZE;
  const page = Math.max(1, options.page ?? 1);

  const listingsTotal = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM listings l
          WHERE l.owner_id = @profileId AND l.status = 'available'
            AND ${blockPair("@userId", "l.owner_id")}`,
      )
      .get({ userId: viewerId ?? "", profileId: userId }) as { count: number }
  ).count;

  const rows = db
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join}
       WHERE l.owner_id = @profileId AND l.status = 'available'
         AND ${blockPair("@userId", "l.owner_id")}
       ORDER BY l.created_at DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({
      userId: viewerId ?? "",
      profileId: userId,
      fromCity: distance.fromCity,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }) as ListingRow[];

  const published = (
    db
      .prepare("SELECT COUNT(*) AS count FROM listings WHERE owner_id = ? AND status <> 'removed'")
      .get(userId) as { count: number }
  ).count;
  const completed = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM requests WHERE status = 'completed' AND (owner_id = ? OR requester_id = ?)",
      )
      .get(userId, userId) as { count: number }
  ).count;
  const rating = db
    .prepare(
      `SELECT AVG(r.rating) AS average, COUNT(*) AS count
       FROM reviews r JOIN users author ON author.id = r.author_id
       WHERE r.target_id = @profileId AND author.is_suspended = 0
         ${viewerId ? `AND ${blockPair("@viewerId", "r.author_id")}` : ""}`,
    )
    .get(
      viewerId ? { profileId: userId, viewerId } : { profileId: userId },
    ) as { average: number | null; count: number };
  // Mismo filtro que la pestaña de comentarios del perfil.
  const comments = countAuthorComments(userId, viewerId ? { id: viewerId, isAdmin: false } : null);
  const follow = getFollowState(userId, viewerId);
  const memberSince = (
    db.prepare("SELECT created_at AS value FROM users WHERE id = ?").get(userId) as {
      value: string;
    }
  ).value;

  // Solo datos públicos: nunca correo ni rol.
  const publicUser: PublicUser = {
    id: user.id,
    name: user.name,
    city: user.city,
    bio: user.bio,
    isTeam: user.isAdmin,
  };

  return {
    user: publicUser,
    listings: rows.map((row) => toListingView(row, viewerId)),
    listingsTotal,
    page,
    pageSize,
    hasMoreListings: page * pageSize < listingsTotal,
    published,
    completed,
    comments,
    ratingAverage: rating.average === null ? null : Math.round(rating.average * 10) / 10,
    ratingCount: rating.count,
    followers: follow.followers,
    following: follow.following,
    isFollowing: follow.isFollowing,
    isBlocked: viewerId ? isBlocked(viewerId, userId) : false,
    isMe: viewerId === userId,
    memberSince,
  };
}

