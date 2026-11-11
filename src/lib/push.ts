import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { getDb } from "./db";

/**
 * Avisos del navegador (Web Push).
 *
 * El servidor guarda una fila por dispositivo y navegador; las claves las
 * genera el navegador al suscribirse y aquí solo se usan para firmar el envío.
 * Sin `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` todo esto es un no-op silencioso:
 * la campana de la web sigue funcionando igual.
 *
 * La clave pública se sirve por `GET /api/push` (no por `NEXT_PUBLIC_*`): así no
 * hay que recompilar para cambiarla, que es lo que pasaría con una variable de
 * build.
 */

export type PushPayload = {
  title: string;
  body?: string;
  /** Ruta interna (`/intercambios`); el service worker la resuelve al origen. */
  url?: string;
  tag?: string;
};

export type PushConfig = { publicKey: string; privateKey: string; subject: string };

/** Tope de dispositivos por cuenta: un navegador por fila, no cientos. */
export const MAX_PUSH_PER_USER = 6;

export function pushConfig(
  env: Record<string, string | undefined> = process.env,
): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: env.VAPID_SUBJECT?.trim() || "mailto:webmaster@wanderbibliothek.org",
  };
}

export function pushEnabled(): boolean {
  return pushConfig() !== null;
}

/**
 * Guarda (o refresca) la suscripción de un dispositivo.
 *
 * `endpoint` es único: si el mismo navegador se suscribe otra vez, o si en ese
 * dispositivo entra otra cuenta, la fila se reasigna en lugar de duplicarse.
 */
export function savePushSubscription(input: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent,
       created_at = excluded.created_at`,
  ).run(
    `psh_${randomUUID()}`,
    input.userId,
    input.endpoint,
    input.p256dh,
    input.auth,
    (input.userAgent ?? "").slice(0, 200),
  );

  // Se conservan los N más recientes de esa cuenta.
  const sobrantes = db
    .prepare(
      `SELECT id FROM push_subscriptions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ?`,
    )
    .all(input.userId, MAX_PUSH_PER_USER) as { id: string }[];
  for (const fila of sobrantes) {
    db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(fila.id);
  }
}

/** Borra la suscripción de este dispositivo (solo si es de esa persona). */
export function removePushSubscription(userId: string, endpoint: string): void {
  getDb()
    .prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
    .run(userId, endpoint);
}

export function pushSubscriptionCount(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?")
    .get(userId) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function deletePushSubscriptionsForUser(userId: string): void {
  getDb().prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(userId);
}

type SubscriptionRow = { endpoint: string; p256dh: string; auth: string };

/**
 * Envía el aviso a todos los dispositivos de una cuenta.
 *
 * Un endpoint que responde 404/410 ya no existe (app desinstalada, permiso
 * retirado): se borra la fila. Cualquier otro error se ignora a propósito: un
 * aviso que no llega no puede tumbar la acción que lo provocó.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const config = pushConfig();
  if (!config) return 0;

  const db = getDb();
  const rows = db
    .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as SubscriptionRow[];
  if (rows.length === 0) return 0;

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const cuerpo = JSON.stringify(payload);

  let enviados = 0;
  for (const row of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        cuerpo,
        { TTL: 3600 },
      );
      enviados += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(row.endpoint);
      }
    }
  }
  return enviados;
}
