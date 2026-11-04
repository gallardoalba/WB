import { getDb } from "../db";
import { notify } from "./notifications";
import { nowIso } from "./shared";

/**
 * Avisos de disponibilidad por ciudad.
 *
 * No son notificaciones push ni correo: se guardan en la bandeja interna. Se
 * avisa solo al publicar un ejemplar nuevo (no al reactivar uno pausado) para
 * que alternar la disponibilidad no se convierta en spam.
 */
export function setAvailabilityAlert(userId: string, city: string, enabled: boolean): void {
  if (enabled) {
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO availability_alerts (user_id, city, created_at) VALUES (?, ?, ?)",
      )
      .run(userId, city, nowIso());
    return;
  }
  getDb()
    .prepare("DELETE FROM availability_alerts WHERE user_id = ? AND city = ?")
    .run(userId, city);
}

export function listAvailabilityAlerts(userId: string): string[] {
  const rows = getDb()
    .prepare("SELECT city FROM availability_alerts WHERE user_id = ? ORDER BY city")
    .all(userId) as { city: string }[];
  return rows.map((row) => row.city);
}

/** Avisa a quien sigue esa ciudad, excluyendo al dueño, bloqueos y suspendidos. */
export function notifyAvailability(input: {
  ownerId: string;
  city: string;
  title: string;
  listingId: string;
  bookId: string;
}): void {
  const recipients = getDb()
    .prepare(
      `SELECT a.user_id AS id
         FROM availability_alerts a
         JOIN users u ON u.id = a.user_id
        WHERE a.city = ? AND u.id <> ? AND u.is_suspended = 0
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
             WHERE (b.blocker_id = a.user_id AND b.blocked_id = ?)
                OR (b.blocker_id = ? AND b.blocked_id = a.user_id)
          )
        ORDER BY a.created_at ASC
        LIMIT 100`,
    )
    .all(input.city, input.ownerId, input.ownerId, input.ownerId) as { id: string }[];

  const alreadyNotified = getDb().prepare(
    "SELECT 1 FROM notifications WHERE user_id = ? AND listing_id = ? AND type = 'availability'",
  );
  for (const recipient of recipients) {
    if (alreadyNotified.get(recipient.id, input.listingId)) continue;
    notify({
      userId: recipient.id,
      type: "availability",
      title: `Novedades en ${input.city}`,
      body: `«${input.title}» acaba de publicarse en ${input.city}.`,
      listingId: input.listingId,
      bookId: input.bookId,
      link: `/libro/${input.listingId}`,
    });
  }
}
