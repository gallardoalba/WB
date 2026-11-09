import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { ApiError } from "./errors";
import type { SessionUser } from "./domain";
import { getTotpState } from "./repo/totp";
import { touchSession } from "./repo/users";
import { normalizeLocale } from "./locale";

const BASE_COOKIE = "b2p_session";
const HOST_COOKIE = "__Host-b2p_session";

/** En producción se usa el prefijo __Host-, que exige Secure, Path=/ y sin Domain. */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? HOST_COOKIE : BASE_COOKIE;
// En producción solo vale la cookie __Host-: una cookie de subdominio con
// Domain=.dominio no debe poder fijar la sesión (login CSRF / cookie tossing).
const READABLE_COOKIES =
  process.env.NODE_ENV === "production" ? [HOST_COOKIE] : [HOST_COOKIE, BASE_COOKIE];
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
/** Tope absoluto: la renovación deslizante nunca supera este tiempo. */
const SESSION_MAX_SECONDS = 60 * 60 * 24 * 30;

function hashToken(token: string): string {
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
  // Tope por cuenta: se conservan las 10 sesiones más recientes. Evita que un
  // cliente que inicia sesión en bucle llene la tabla sin límite.
  db.prepare(
    `DELETE FROM sessions WHERE user_id = @userId AND id NOT IN (
       SELECT id FROM sessions WHERE user_id = @userId
       ORDER BY created_at DESC, rowid DESC LIMIT 10
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

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  for (const name of READABLE_COOKIES) {
    const value = cookieStore.get(name)?.value;
    if (value) return userForToken(value);
  }
  return null;
}

/**
 * Id (hash) de la sesión que acompaña a esta petición. Nunca sale de aquí el
 * token: el hash solo sirve para señalar «este dispositivo» y para cerrarla.
 */
export async function currentSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  for (const name of READABLE_COOKIES) {
    const value = cookieStore.get(name)?.value;
    if (value) return hashToken(value);
  }
  return null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Inicia sesión para continuar.");
  if (user.isSuspended) {
    throw new ApiError(403, "Tu cuenta está suspendida. Contacta con el equipo de moderación.");
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new ApiError(403, "No tienes permisos de administración.");
  // En producción, una sesión de administración robada no debe bastar: el
  // segundo factor es obligatorio para moderar.
  if (process.env.NODE_ENV === "production" && !getTotpState(user.id).enabled) {
    throw new ApiError(403, "Activa la verificación en dos pasos para usar la administración.");
  }
  return user;
}
