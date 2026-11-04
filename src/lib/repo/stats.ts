import { getDb } from "../db";
import type { ActivityView, StatsView } from "../domain";

export function listActivity(limit = 8, city: string | null = null): ActivityView[] {
  const rows = getDb()
    .prepare(
      `SELECT e.id, e.type, e.created_at, e.listing_id, u.name AS actor, b.title
       FROM events e
       JOIN users u ON u.id = e.actor_id
       JOIN listings l ON l.id = e.listing_id
       JOIN books b ON b.id = l.book_id
       WHERE l.status <> 'removed' AND u.is_suspended = 0
         AND (@city IS NULL OR l.city = @city)
       ORDER BY e.created_at DESC, e.rowid DESC
       LIMIT @take`,
    )
    .all({ city, take: limit }) as {
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

export function getStats(): StatsView {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { value: number }).value;
  // Las cifras públicas usan la misma visibilidad que el catálogo (dueño activo).
  return {
    available: one(
      `SELECT COUNT(*) AS value FROM listings l JOIN users u ON u.id = l.owner_id
       WHERE l.status = 'available' AND u.is_suspended = 0`,
    ),
    members: one("SELECT COUNT(*) AS value FROM users WHERE is_suspended = 0"),
    completed: one("SELECT COUNT(*) AS value FROM requests WHERE status = 'completed'"),
    cities: one(
      `SELECT COUNT(DISTINCT l.city) AS value FROM listings l
       JOIN users u ON u.id = l.owner_id
       WHERE l.status <> 'removed' AND u.is_suspended = 0`,
    ),
    clubs: one("SELECT COUNT(*) AS value FROM clubs WHERE status = 'visible'"),
  };
}

