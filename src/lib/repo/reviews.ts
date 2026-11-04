import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { ApiError } from "../errors";
import type { RequestStatus, ReviewView } from "../domain";
import { isConstraintError, nowIso, blockPair } from "./shared";
import { getUserById } from "./users";
import { notify } from "./notifications";

export function addReview(
  requestId: string,
  authorId: string,
  rating: number,
  comment: string,
): void {
  const db = getDb();
  const request = db
    .prepare(
      "SELECT requester_id, owner_id, status, listing_id FROM requests WHERE id = ?",
    )
    .get(requestId) as
    | { requester_id: string; owner_id: string; status: RequestStatus; listing_id: string }
    | undefined;

  if (!request) throw new ApiError(404, "La solicitud no existe.");
  if (request.requester_id !== authorId && request.owner_id !== authorId) {
    throw new ApiError(404, "La solicitud no existe.");
  }
  if (request.status !== "completed") {
    throw new ApiError(409, "Solo puedes valorar un intercambio completado.");
  }

  const targetId = request.requester_id === authorId ? request.owner_id : request.requester_id;
  // Una valoración por persona y intercambio: las dos partes pueden opinar.
  const existing = db
    .prepare("SELECT 1 FROM reviews WHERE request_id = ? AND author_id = ?")
    .get(requestId, authorId);
  if (existing) throw new ApiError(409, "Ya has valorado este intercambio.");

  try {
    db.transaction(() => {
      db.prepare(
        "INSERT INTO reviews (id, request_id, author_id, target_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(`rev_${randomUUID()}`, requestId, authorId, targetId, rating, comment, nowIso());

      const author = getUserById(authorId);
      notify({
        userId: targetId,
        type: "review",
        title: "Nueva valoración",
        body: `${author?.name ?? "Alguien"} te ha valorado con ${rating}/5.`,
        listingId: request.listing_id,
        requestId,
      });
    })();
  } catch (error) {
    if (isConstraintError(error)) throw new ApiError(409, "Ya has valorado este intercambio.");
    throw error;
  }
}

export function listReviews(
  userId: string,
  limit = 10,
  viewerId: string | null = null,
): ReviewView[] {
  const blocked = viewerId ? `AND ${blockPair("@viewerId", "r.author_id")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.rating, r.comment, r.created_at, r.author_id, u.name AS author_name
       FROM reviews r JOIN users u ON u.id = r.author_id
       WHERE r.target_id = @userId AND u.is_suspended = 0 ${blocked}
       ORDER BY r.created_at DESC LIMIT @limit`,
    )
    .all(viewerId ? { userId, limit, viewerId } : { userId, limit }) as {
    id: string;
    rating: number;
    comment: string;
    created_at: string;
    author_id: string;
    author_name: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    authorId: row.author_id,
    authorName: row.author_name,
  }));
}

export function hasReviewed(requestId: string, authorId: string): boolean {
  return Boolean(
    getDb()
      .prepare("SELECT 1 FROM reviews WHERE request_id = ? AND author_id = ?")
      .get(requestId, authorId),
  );
}

