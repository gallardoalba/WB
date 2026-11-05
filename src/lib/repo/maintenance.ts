import { getDb } from "../db";
import { pruneCoverCache } from "../covers";
import { notifyUpcomingMeetings } from "./clubs";
import { listingTitle, notify } from "./notifications";

let lastExpiryRun = Number.NEGATIVE_INFINITY;

/**
 * Igual que `expireStaleRequests`, pero como mucho una vez cada `minutes` por
 * proceso: el render no debe pagar un SELECT extra en cada visita.
 *
 * Se mide con `performance.now()` (reloj monótono del proceso) y no con
 * `Date.now()`: esto corre dentro de `after()`, que Next también ejecuta en el
 * prerender, y ahí leer la hora del sistema es un error de construcción.
 */
export function expireStaleRequestsThrottled(minutes = 5, days = 14): number {
  const mark = performance.now();
  if (mark - lastExpiryRun < minutes * 60_000) return 0;
  lastExpiryRun = mark;
  return expireStaleRequests(days);
}

/** Expira solicitudes pendientes antiguas y avisa a quien las envió. */
export function expireStaleRequests(days = 14): number {
  const db = getDb();
  const stale = db
    .prepare(
      `SELECT id, requester_id, listing_id, created_at FROM requests
       WHERE status = 'pending' AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    )
    .all(`-${days} days`) as {
    id: string;
    requester_id: string;
    listing_id: string;
    created_at: string;
  }[];

  if (stale.length === 0) return 0;

  db.transaction(() => {
    const update = db.prepare(
      `UPDATE requests SET status = 'expired', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
    );
    for (const request of stale) {
      update.run(request.id);
      notify({
        userId: request.requester_id,
        type: "expired",
        title: "Tu solicitud ha expirado",
        body: `Nadie respondió a tu solicitud de «${listingTitle(request.listing_id)}».`,
        listingId: request.listing_id,
        requestId: request.id,
      });
    }
  })();

  return stale.length;
}
export type MaintenanceReport = {
  expiredRequests: number;
  sessions: number;
  throttle: number;
  authAttempts: number;
  notifications: number;
  events: number;
  audit: number;
  clubReminders: number;
  covers: number;
};

/**
 * Tareas periódicas: caducar solicitudes antiguas y purgar datos que ya no
 * hacen falta. Pensada para un cron (no para el camino de render).
 */
export function runMaintenance(): MaintenanceReport {
  const db = getDb();
  const expiredRequests = expireStaleRequests();
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const changes = (sql: string, ...params: unknown[]) =>
    db.prepare(sql).run(...params).changes;

  const sessions = changes(
    "DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  );
  const throttle = changes("DELETE FROM throttle WHERE created_at < ?", daysAgo(1));
  const authAttempts = changes("DELETE FROM auth_attempts WHERE created_at < ?", daysAgo(1));
  // Avisos leídos > 90 días y cualquier aviso > 180 (aunque nunca se abriera),
  // más el rastro de actividad viejo.
  const notifications =
    changes("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?", daysAgo(90)) +
    changes("DELETE FROM notifications WHERE created_at < ?", daysAgo(180));
  // Si el libro de un aviso desapareció, el enlace quedaría roto: se limpia el
  // puntero (el enlace se reconstruye desde el tipo y el resto de columnas).
  changes(
    `UPDATE notifications SET book_id = NULL
      WHERE book_id IS NOT NULL AND book_id NOT IN (SELECT id FROM books)`,
  );
  const events = changes("DELETE FROM events WHERE created_at < ?", daysAgo(180));
  // La auditoría se conserva por defecto; con AUDIT_RETENTION_DAYS se poda.
  const auditDays = Number(process.env.AUDIT_RETENTION_DAYS ?? 0) || 0;
  const audit =
    auditDays > 0
      ? changes("DELETE FROM admin_audit WHERE created_at < ?", daysAgo(auditDays))
      : 0;

  const clubReminders = notifyUpcomingMeetings();
  // Las portadas cacheadas se acumulan con cada ISBN visitado: se olvidan las
  // que nadie ha pedido en medio año.
  const covers = pruneCoverCache();

  // SQLite no devuelve el espacio al sistema al borrar filas y el WAL crece
  // hasta el siguiente checkpoint: sin esto, la base solo engorda. `optimize`
  // es barato (recalcula estadísticas cuando toca) y el checkpoint trunca el
  // WAL, que es lo que ocupa disco entre reinicios.
  try {
    db.pragma("optimize");
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (error) {
    // Un checkpoint fallido (otra conexión leyendo, por ejemplo) no debe
    // invalidar el resto del mantenimiento.
    console.warn("[maintenance] no se pudo compactar la base", error);
  }

  return {
    expiredRequests,
    sessions,
    throttle,
    authAttempts,
    notifications,
    events,
    audit,
    clubReminders,
    covers,
  };
}

