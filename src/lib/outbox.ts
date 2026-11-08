import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { sendMail, type Mail } from "./mailer";

/**
 * Bandeja de salida de correo.
 *
 * Los enlaces de verificación y recuperación se encolan en la misma base que el
 * token. Un worker (el `after()` de la petición o el cron) los intenta enviar y
 * los reintenta con backoff; antes, un fallo del proveedor perdía el correo.
 */
export function enqueueMail(mail: Mail): string {
  const id = `mail_${randomUUID()}`;
  getDb()
    .prepare(
      `INSERT INTO mail_outbox (id, to_email, subject, body, status, attempts, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
    .run(id, mail.to, mail.subject, mail.text);
  return id;
}

/**
 * Intenta entregar los correos pendientes. Es idempotente a nivel de fila: si
 * dos workers coinciden, ambos pueden enviar (el proveedor debería deduplicar
 * por `Message-ID`); para esta escala se ejecuta desde un único cron.
 */
export async function processOutbox(limit = 20): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, to_email, subject, body, attempts
         FROM mail_outbox
        WHERE status = 'pending'
          AND next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    to_email: string;
    subject: string;
    body: string;
    attempts: number;
  }[];

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await sendMail({
      to: row.to_email,
      subject: row.subject,
      text: row.body,
    });
    if (result.delivered) {
      db.prepare(
        "UPDATE mail_outbox SET status = 'sent', sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_error = NULL WHERE id = ?",
      ).run(row.id);
      sent += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    const finalFailure = attempts >= 5;
    const delaySeconds = Math.min(3600, 2 ** attempts * 60);
    db.prepare(
      `UPDATE mail_outbox
          SET attempts = ?, status = ?, last_error = ?,
              next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
        WHERE id = ?`,
    ).run(
      attempts,
      finalFailure ? "failed" : "pending",
      "El proveedor no confirmó la entrega.",
      `+${delaySeconds} seconds`,
      row.id,
    );
    failed += 1;
  }
  return { sent, failed };
}

/**
 * Elimina correos entregados o fallidos antiguos y, aparte, los pendientes
 * atascados.
 *
 * Por defecto 7 días para lo terminado: el cuerpo guarda enlaces de
 * verificación y de restablecimiento, cuyos tokens caducan en 24 h y 1 h.
 * Conservarlos un mes no aporta nada y mantiene datos personales de más.
 *
 * Un pendiente se reintenta cinco veces con espera creciente (una hora como
 * mucho), así que a los 30 días ya no es trabajo: es una fila muerta que sigue
 * llevando el token en el cuerpo. Antes se quedaba para siempre porque la poda
 * solo miraba los estados finales.
 */
export function purgeOutbox(days = 7, stuckDays = 30): number {
  const db = getDb();
  const terminados = db
    .prepare(
      `DELETE FROM mail_outbox
        WHERE status <> 'pending'
          AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    )
    .run(`-${days} days`).changes;
  const atascados = db
    .prepare(
      `DELETE FROM mail_outbox
        WHERE status = 'pending'
          AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    )
    .run(`-${stuckDays} days`).changes;
  return terminados + atascados;
}
