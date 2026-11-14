/**
 * Almacén de sesiones: alta, consulta, renovación y cierre.
 *
 * Vive aparte de `auth.ts` a propósito. Aquí no hay nada de React (`cookies()`,
 * `server-only`), así que el ciclo de vida de una sesión —renovación deslizante,
 * tope absoluto de 30 días, purga de caducadas, tope de 10 por cuenta— se puede
 * probar de verdad, sin levantar la aplicación. `auth.ts` se queda con lo que sí
 * necesita la petición: leer la cookie, exigir sesión y exigir administración.
 */

import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./db";
import type { SessionUser } from "./domain";
import { touchSession } from "./repo/users";
import { normalizeLocale } from "./locale";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
/** Tope absoluto: la renovación deslizante nunca supera este tiempo. */
const SESSION_MAX_SECONDS = 60 * 60 * 24 * 30;
/** Sesiones simultáneas por cuenta. */
const MAX_SESSIONS_PER_USER = 10;

/** El token nunca se guarda: la tabla tiene su SHA-256. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function createSession(userId: string, userAgent = ""): string {
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    // El navegador se guarda en crudo: es lo que permite enseñar «Chrome» o
    // «App» en la lista de sesiones. `last_seen_at` nace en el alta.
  ).run(
    hashToken(token),
    userId,
    now.toISOString(),
    expiresAt.toISOString(),
    userAgent.slice(0, 300),
    now.toISOString(),
  );
  // Tope por cuenta: se conservan las sesiones más recientes. Evita que un
  // cliente que inicia sesión en bucle llene la tabla sin límite.
  db.prepare(
    `DELETE FROM sessions WHERE user_id = @userId AND id NOT IN (
       SELECT id FROM sessions WHERE user_id = @userId
       ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_SESSIONS_PER_USER}
     )`,
  ).run({ userId });

  return token;
}

export function destroySession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(hashToken(token));
}

/** Cierra todas las sesiones de una cuenta ("cerrar en todos los dispositivos"). */
export function destroyUserSessions(userId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

type SessionRow = {
  id: string;
  name: string;
  email: string;
  city: string;
  bio: string;
  is_admin: number;
  is_suspended: number;
  email_verified_at: string | null;
  email_notifications: number;
  locale: string;
  profile_visibility: string;
  city_precision: string;
  sign_as: string;
  dm_policy: string;
  session_id: string;
  expires_at: string;
  absolute_expired: number;
  renew: number;
};

export function userForToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const db = getDb();
  const sessionId = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.city, u.bio, u.is_admin, u.is_suspended,
              u.email_verified_at, u.email_notifications, u.locale,
              u.profile_visibility, u.city_precision, u.sign_as, u.dm_policy,
              s.id AS session_id, s.expires_at,
              CASE WHEN s.created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
                   THEN 1 ELSE 0 END AS absolute_expired,
              CASE WHEN s.expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days')
                   THEN 1 ELSE 0 END AS renew
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .get(`-${SESSION_MAX_SECONDS} seconds`, sessionId) as SessionRow | undefined;

  if (!row) return null;
  if (row.absolute_expired) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return null;
  }

  // Marca de último uso para la lista de sesiones (escribe como mucho cada
  // cinco minutos).
  touchSession(sessionId);

  // Renovación deslizante: si a la sesión le queda menos de una semana se
  // alarga hasta 14 días, sin superar nunca el tope absoluto de 30.
  if (row.renew) {
    db.prepare(
      `UPDATE sessions
          SET expires_at = CASE
                WHEN julianday(created_at, '+30 days') < julianday('now', '+14 days')
                  THEN strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+30 days')
                ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+14 days')
              END
        WHERE id = ?`,
    ).run(sessionId);
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    city: row.city,
    bio: row.bio,
    isAdmin: Boolean(row.is_admin),
    isSuspended: Boolean(row.is_suspended),
    emailVerified: Boolean(row.email_verified_at),
    emailNotifications: row.email_notifications !== 0,
    // Sin idioma guardado (o con uno desconocido) la cuenta lee en alemán.
    locale: normalizeLocale(row.locale),
    profileVisibility: setting(row.profile_visibility, ["members", "followers", "private"], "members"),
    cityPrecision: setting(row.city_precision, ["exact", "hidden"], "exact"),
    signAs: setting(row.sign_as, ["name", "community"], "name"),
    dmPolicy: setting(row.dm_policy, ["mutual", "exchanged"], "mutual"),
  };
}

/** Preferencia guardada, con caída al valor por defecto si no se reconoce. */
function setting<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
