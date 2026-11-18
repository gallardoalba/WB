import { randomUUID } from "node:crypto";
import { getDb } from "./db";

/**
 * Registro de trabajos diferidos.
 *
 * Cualquier cosa que no se puede terminar dentro de la petición —un correo, un
 * aviso a Mastodon— acaba aquí con el mismo patrón: estado, intentos, próximo
 * intento y último error. Antes cada cola tenía su tabla y sus columnas
 * copiadas, así que para saber «qué no ha salido» había que mirar en tres
 * sitios y cada uno reintentaba a su manera.
 *
 * `payload` es JSON a propósito: no hay dos tipos de trabajo que necesiten las
 * mismas columnas, y el esquema no debe crecer con cada uno. `target` existe
 * aparte porque es lo único que se consulta por ahí —la dirección de un correo,
 * para el tope anti-spam y para borrar lo pendiente al darse de baja— y desde
 * JSON no se indexa con la misma comodidad.
 *
 * Nada de esto requiere un servicio más: una tabla en la misma base, que ya
 * viaja en la copia de seguridad y sobrevive a un reinicio.
 */

/** Estados de un trabajo. `running` es una reclamación con caducidad. */
export type JobStatus = "pending" | "running" | "done" | "failed";

export type NewJob = {
  /** Qué es: `mail`, y los que vengan. */
  kind: string;
  /** Lo que se consulta por ahí (correo destinatario, por ejemplo). */
  target?: string | null;
  /** El contenido, serializable a JSON. */
  payload: unknown;
  /** Cuándo se puede intentar por primera vez. Por defecto, ya. */
  runAt?: string;
};

export type ClaimedJob<T> = {
  id: string;
  target: string | null;
  attempts: number;
  payload: T;
};

/** Intentos antes de darse por vencido. */
export const MAX_ATTEMPTS = 5;

/** Minutos que un trabajo puede estar «en curso» antes de darlo por abandonado. */
const CLAIM_SECONDS = 5 * 60;

export function enqueueJob(job: NewJob): string {
  const id = `job_${randomUUID()}`;
  getDb()
    .prepare(
      `INSERT INTO jobs (id, kind, target, payload, status, attempts, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
    .run(
      id,
      job.kind,
      job.target ?? null,
      JSON.stringify(job.payload ?? {}),
      job.runAt ?? now(),
    );
  return id;
}

/**
 * Reclama hasta `limit` trabajos pendientes de un tipo.
 *
 * Seleccionar y marcar pasa en la misma transacción: con una sola conexión eso
 * basta para que dos ejecuciones simultáneas (el `after()` de la petición y el
 * cron) no se repartan la misma fila y el correo salga dos veces.
 *
 * Una reclamación que se queda colgada (el proceso murió a mitad) vuelve a
 * `pending` pasados cinco minutos, que es más que cualquier espera del
 * proveedor.
 */
export function claimJobs<T>(kind: string, limit: number): ClaimedJob<T>[] {
  const db = getDb();
  return db.transaction(() => {
    db.prepare(
      `UPDATE jobs SET status = 'pending'
        WHERE kind = ? AND status = 'running'
          AND next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).run(kind);

    const rows = db
      .prepare(
        `SELECT id, target, payload, attempts
           FROM jobs
          WHERE kind = ? AND status = 'pending'
            AND next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
          ORDER BY created_at ASC
          LIMIT ?`,
      )
      .all(kind, limit) as { id: string; target: string | null; payload: string; attempts: number }[];

    const claim = db.prepare(
      `UPDATE jobs
          SET status = 'running',
              next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
        WHERE id = ? AND status = 'pending'`,
    );
    return rows
      .filter((row) => claim.run(`+${CLAIM_SECONDS} seconds`, row.id).changes === 1)
      .map((row) => ({
        id: row.id,
        target: row.target,
        attempts: row.attempts,
        payload: JSON.parse(row.payload) as T,
      }));
  })();
}

/** El trabajo se hizo: se queda como `done` para la poda y para las métricas. */
export function finishJob(id: string): void {
  getDb()
    .prepare(
      `UPDATE jobs
          SET status = 'done', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_error = NULL
        WHERE id = ?`,
    )
    .run(id);
}

export type JobFailure = { attempts: number; final: boolean; retryAt: string | null };

/**
 * El intento falló: se cuenta, se calcula la espera y, al quinto, se da por
 * perdido. La espera crece al doble (dos minutos, cuatro, ocho…) con una hora
 * como tope: un proveedor caído una tarde no debe convertirse en una fila que
 * reintenta cada minuto para siempre.
 */
export function failJob(id: string, error: string, attempts: number): JobFailure {
  const next = attempts + 1;
  const final = next >= MAX_ATTEMPTS;
  const delaySeconds = Math.min(3600, 2 ** next * 60);
  const retryAt = final ? null : plusSeconds(delaySeconds);
  getDb()
    .prepare(
      `UPDATE jobs
          SET attempts = ?, status = ?, last_error = ?, next_attempt_at = ?
        WHERE id = ?`,
    )
    .run(next, final ? "failed" : "pending", error.slice(0, 300), retryAt ?? now(), id);
  return { attempts: next, final, retryAt };
}

/**
 * Borra trabajos terminados antiguos.
 *
 * Siete días para lo terminado: el contenido de un correo lleva enlaces de
 * verificación y de restablecimiento, cuyos tokens caducan en 24 h y 1 h, y no
 * aporta nada conservarlos un mes. Un pendiente se reintenta cinco veces con
 * espera creciente, así que a los 30 días ya no es trabajo: es una fila muerta
 * con datos personales dentro.
 */
export function purgeJobs(kind: string, doneDays = 7, stuckDays = 30): number {
  const db = getDb();
  const terminados = db
    .prepare(
      `DELETE FROM jobs
        WHERE kind = ? AND status IN ('done', 'failed')
          AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    )
    .run(kind, `-${doneDays} days`).changes;
  const atascados = db
    .prepare(
      `DELETE FROM jobs
        WHERE kind = ? AND status IN ('pending', 'running')
          AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    )
    .run(kind, `-${stuckDays} days`).changes;
  return terminados + atascados;
}

export type JobStats = {
  pending: number;
  running: number;
  failed: number;
  failed24h: number;
  /** Minutos que lleva esperando el pendiente más antiguo (0 si no hay). */
  oldestPendingMinutes: number;
  /** Último error registrado, para el aviso del vigilante. */
  lastError: string | null;
};

/** Foto de la cola, para `/api/metrics` y el vigilante. Sin contenido. */
export function jobStats(kind: string): JobStats {
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'failed'
                   AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')
                  THEN 1 ELSE 0 END) AS failed24h,
         MIN(CASE WHEN status = 'pending' THEN created_at END) AS oldest
       FROM jobs WHERE kind = ?`,
    )
    .get(kind) as { pending: number | null; running: number | null; failed: number | null; failed24h: number | null; oldest: string | null };

  const last = db
    .prepare(
      `SELECT last_error FROM jobs
        WHERE kind = ? AND last_error IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(kind) as { last_error: string } | undefined;

  return {
    pending: counts.pending ?? 0,
    running: counts.running ?? 0,
    failed: counts.failed ?? 0,
    failed24h: counts.failed24h ?? 0,
    oldestPendingMinutes: counts.oldest ? minutesSince(counts.oldest) : 0,
    lastError: last?.last_error ?? null,
  };
}

function now(): string {
  return new Date().toISOString();
}

function plusSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function minutesSince(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((Date.now() - then) / 60_000));
}
