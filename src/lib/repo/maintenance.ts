import { dbMetrics, getDb, type DbMetrics } from "../db";
import { DELIVERY_INCIDENT_REASON } from "../domain";
import { pruneCoverCache } from "../covers";
import { notifyUpcomingMeetings } from "./clubs";
import { purgeOldDisclosures } from "./clubcrypto";
import { listingTitle, notify } from "./notifications";
import { expireDueSuspensions } from "./users";

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

/**
 * Recordatorio suave para intercambios aceptados que llevan días sin avanzar.
 *
 * No caduca ni libera el ejemplar: el libro puede estar en tránsito y cerrar el
 * intercambio por inactividad sería peor que recordarlo. Se envía como mucho
 * una vez cada `days` por intercambio; los avisos de tipo `accepted` de la
 * bandeja sirven de marca (el título se guarda traducido, el tipo no) para no
 * añadir otra columna ni otra migración. Se limita a 50 por pasada para que un
 * histórico grande no genere una ráfaga de avisos de golpe.
 *
 * Una incidencia abierta deja el intercambio fuera: ni quien dice que el libro
 * no llegó ni la otra parte tienen que firmar nada mientras decide moderación.
 */
export function remindStaleAcceptedRequests(days = 7): number {
  const db = getDb();
  const stale = db
    .prepare(
      `SELECT r.id, r.listing_id, r.owner_id, r.requester_id,
              r.owner_confirmed_at, r.requester_confirmed_at
         FROM requests r
        WHERE r.status = 'accepted'
          AND r.updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.request_id = r.id
               AND n.type = 'accepted'
               AND n.created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM reports rp
             WHERE rp.target_type = 'request'
               AND rp.target_id = r.id
               AND rp.status = 'open'
               AND rp.reason = ?
          )
        ORDER BY r.updated_at ASC
        LIMIT 50`,
    )
    .all(`-${days} days`, `-${days} days`, DELIVERY_INCIDENT_REASON) as {
    id: string;
    listing_id: string;
    owner_id: string;
    requester_id: string;
    owner_confirmed_at: string | null;
    requester_confirmed_at: string | null;
  }[];

  if (stale.length === 0) return 0;

  db.transaction(() => {
    for (const request of stale) {
      const title = listingTitle(request.listing_id);
      // Solo se recuerda a quien aún no ha firmado: si una parte ya confirmó,
      // la otra no necesita que le pidan lo mismo que ya hizo.
      if (!request.owner_confirmed_at) {
        notify({
          userId: request.owner_id,
          type: "accepted",
          title: "Recordatorio: falta confirmar la entrega",
          body: `«${title}» · Lleváis unos días sin confirmar la entrega. Si ya lo has entregado o enviado, confírmalo para cerrar el intercambio.`,
          listingId: request.listing_id,
          requestId: request.id,
          link: `/intercambios?t=${request.id}`,
        });
      }
      if (!request.requester_confirmed_at) {
        notify({
          userId: request.requester_id,
          type: "accepted",
          title: "Recordatorio: falta confirmar la recepción",
          body: `«${title}» · Lleváis unos días sin confirmar la recepción. Si ya tienes el libro, confirma que lo has recibido.`,
          listingId: request.listing_id,
          requestId: request.id,
          link: `/intercambios?t=${request.id}`,
        });
      }
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
  productEvents: number;
  audit: number;
  /** Denuncias ya resueltas que se han tirado (retención: un año). */
  resolvedReports: number;
  /** Suspensiones temporales que han vencido y se han levantado. */
  expiredSuspensions: number;
  /** Apelaciones resueltas que se han tirado (retención: dos años). */
  appeals: number;
  /** Intercambios aceptados a los que se ha recordado que falta confirmar. */
  acceptedReminders: number;
  clubReminders: number;
  covers: number;
  /** Revelaciones de club antiguas que se han borrado. */
  disclosures: number;
  /** Tamaño de la base y del WAL, ya después del checkpoint. */
  db: DbMetrics;
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
  // `product_events` guarda visitas a clubes y avisos de mensajes nuevos **con
  // `user_id`**: es un dato personal de actividad, no una estadística anónima, y
  // sin esta poda crecía para siempre. Mismo plazo que `events`.
  const productEvents = changes(
    "DELETE FROM product_events WHERE created_at < ?",
    daysAgo(180),
  );
  // La auditoría de moderación se poda a los 730 días, que es lo que publica la
  // política de privacidad. `AUDIT_RETENTION_DAYS=0` la conserva sin límite para
  // quien prefiera el histórico completo (y así lo tiene que decir la política).
  const auditSetting = process.env.AUDIT_RETENTION_DAYS?.trim();
  const auditDays = auditSetting === "0" ? 0 : Number(auditSetting ?? 730) || 730;
  const audit =
    auditDays > 0
      ? changes("DELETE FROM admin_audit WHERE created_at < ?", daysAgo(auditDays))
      : 0;
  // Las denuncias resueltas se tiran al año: guardan el texto libre de quien
  // denuncia, que puede hablar de terceras personas, y el histórico de
  // moderación que hace falta conservar ya está en `admin_audit`.
  const resolvedReports = changes(
    "DELETE FROM reports WHERE status <> 'open' AND created_at < ?",
    daysAgo(365),
  );

  // Una suspensión temporal se levanta al vencer, sin esperar a que alguien se
  // acuerde. El acceso también lo comprueba, por si el cron va con retraso.
  // Las apelaciones resueltas guardan texto libre: mismo plazo que la
  // auditoría (dos años) y nunca se tocan las abiertas.
  // Las revelaciones llevan texto libre de quien denuncia y los sobres de un
  // mensaje concreto: mismo plazo que la auditoría.
  const disclosures = purgeOldDisclosures(db);

  const appeals = changes(
    "DELETE FROM appeals WHERE status <> 'open' AND created_at < ?",
    daysAgo(730),
  );

  const expiredSuspensions = expireDueSuspensions();
  for (const userId of expiredSuspensions) {
    notify({
      userId,
      type: "moderation",
      title: "Tu cuenta vuelve a estar activa",
      body: "Puedes volver a entrar y publicar ejemplares.",
    });
  }

  const acceptedReminders = remindStaleAcceptedRequests();
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
    productEvents,
    audit,
    resolvedReports,
    expiredSuspensions: expiredSuspensions.length,
    appeals,
    acceptedReminders,
    clubReminders,
    covers,
    disclosures,
    // Se mide **después** del checkpoint: es el tamaño que ocupa de verdad.
    db: dbMetrics(),
  };
}

