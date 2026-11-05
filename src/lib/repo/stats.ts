import { getDb } from "../db";
import type { ActivityView, StatsView } from "../domain";

export function listActivity(limit = 8, city: string | null = null): ActivityView[] {
  const rows = getDb()
    .prepare(
      `SELECT e.id, e.type, e.created_at, e.listing_id, u.name AS actor, b.title
       FROM events e
       JOIN users u ON u.id = e.actor_id
       JOIN listings l ON l.id = e.listing_id
       JOIN users owner ON owner.id = l.owner_id
       JOIN books b ON b.id = l.book_id
       WHERE l.status <> 'removed' AND u.is_suspended = 0 AND owner.is_suspended = 0
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
    // Solo intercambios entre cuentas que siguen activas: si una se borra, su
    // historial no infla las cifras públicas.
    completed: one(
      `SELECT COUNT(*) AS value FROM requests r
         JOIN users owner ON owner.id = r.owner_id
         JOIN users requester ON requester.id = r.requester_id
        WHERE r.status = 'completed'
          AND owner.is_suspended = 0 AND requester.is_suspended = 0`,
    ),
    cities: one(
      `SELECT COUNT(DISTINCT l.city) AS value FROM listings l
       JOIN users u ON u.id = l.owner_id
       WHERE l.status <> 'removed' AND u.is_suspended = 0`,
    ),
    clubs: one(
      `SELECT COUNT(*) AS value FROM clubs c JOIN users u ON u.id = c.owner_id
        WHERE c.status = 'visible' AND u.is_suspended = 0`,
    ),
    // Cuántos títulos distintos hay en circulación: «5 libros» dice menos que
    // «5 ejemplares de 4 títulos».
    titles: one(
      `SELECT COUNT(DISTINCT l.book_id) AS value FROM listings l
         JOIN users u ON u.id = l.owner_id
        WHERE l.status = 'available' AND u.is_suspended = 0`,
    ),
    // Kilómetros que han viajado los libros ya intercambiados (misma tabla de
    // distancias que usa el recorrido de cada lector).
    km: one(
      `SELECT COALESCE(SUM(cd.km), 0) AS value FROM requests r
         JOIN users own ON own.id = r.owner_id
         JOIN users req ON req.id = r.requester_id
         LEFT JOIN city_distances cd
                ON cd.from_name = own.city AND cd.to_name = req.city
        WHERE r.status = 'completed' AND own.is_suspended = 0 AND req.is_suspended = 0`,
    ),
    clubsUpcoming: one(
      `SELECT COUNT(*) AS value FROM clubs c JOIN users u ON u.id = c.owner_id
        WHERE c.status = 'visible' AND u.is_suspended = 0
          AND c.meets_at <> ''
          AND c.meets_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ),
  };
}

