import { claimJobs, enqueueJob, failJob, finishJob, jobStats, purgeJobs, type JobStats } from "./jobs";
import { sendMail, type Mail } from "./mailer";

/**
 * Bandeja de salida de correo.
 *
 * Los enlaces de verificación y recuperación se encolan en la misma base que el
 * token, como trabajos de tipo `mail` (ver `jobs.ts`). Un worker (el `after()`
 * de la petición o el cron) los intenta enviar y los reintenta con espera
 * creciente; antes, un fallo del proveedor perdía el correo.
 *
 * Lo propio del correo —asunto, cuerpo, dirección— va en el `payload` del
 * trabajo, y la dirección se copia además en `target` porque es lo que se
 * consulta para el tope anti-spam y para borrar lo pendiente de una baja.
 */
export const MAIL_JOB = "mail";

type MailPayload = { to: string; subject: string; text: string };

export function enqueueMail(mail: Mail): string {
  return enqueueJob({
    kind: MAIL_JOB,
    target: mail.to,
    payload: { to: mail.to, subject: mail.subject, text: mail.text } satisfies MailPayload,
  });
}

/** Intenta entregar los correos pendientes. */
export async function processOutbox(limit = 20): Promise<{ sent: number; failed: number }> {
  const jobs = claimJobs<MailPayload>(MAIL_JOB, limit);

  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    const result = await sendMail({
      to: job.payload.to,
      subject: job.payload.subject,
      text: job.payload.text,
    });
    if (result.delivered) {
      finishJob(job.id);
      sent += 1;
      continue;
    }
    failJob(job.id, "El proveedor no confirmó la entrega.", job.attempts);
    failed += 1;
  }
  return { sent, failed };
}

/** Correos terminados antiguos y, aparte, pendientes atascados. */
export function purgeOutbox(days = 7, stuckDays = 30): number {
  return purgeJobs(MAIL_JOB, days, stuckDays);
}

/** Foto de la cola de correo, sin contenido: la usan `/api/metrics` y el vigilante. */
export function outboxStats(): JobStats {
  return jobStats(MAIL_JOB);
}
