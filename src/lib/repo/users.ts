import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { ApiError } from "../errors";
import type { SessionUser } from "../domain";
import { keyIdFromJwk } from "../key-id";
import { assertPublicName, isConstraintError, nowIso } from "./shared";

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_FAILURES = 6;

export function assertVerified(userId: string): void {
  const flag = process.env.REQUIRE_EMAIL_VERIFICATION;
  // En producción se exige por defecto; `REQUIRE_EMAIL_VERIFICATION=0` es la
  // única forma deliberada de desactivarlo.
  const required = flag === "1" || (flag !== "0" && process.env.NODE_ENV === "production");
  if (!required) return;
  const user = getUserById(userId);
  if (!user?.emailVerified) {
    throw new ApiError(403, "Confirma tu correo antes de continuar.");
  }
}

/* ------------------------------ usuarios ------------------------------ */

type UserRow = {
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
};

function toSessionUser(row: UserRow): SessionUser {
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
    locale: row.locale === "de" ? "de" : "es",
  };
}

export function getUserById(id: string): SessionUser | null {
  const row = getDb()
    .prepare(
      "SELECT id, name, email, city, bio, is_admin, is_suspended, email_verified_at, email_notifications, locale FROM users WHERE id = ?",
    )
    .get(id) as UserRow | undefined;
  return row ? toSessionUser(row) : null;
}

export function getUserWithPassword(
  email: string,
): (SessionUser & { passwordHash: string }) | null {
  const row = getDb()
    .prepare(
      "SELECT id, name, email, city, bio, is_admin, is_suspended, email_verified_at, email_notifications, locale, password_hash AS passwordHash FROM users WHERE email = ?",
    )
    .get(email) as (UserRow & { passwordHash: string }) | undefined;
  if (!row) return null;
  return { ...toSessionUser(row), passwordHash: row.passwordHash };
}

/** Guarda el idioma elegido para que los correos salgan en el idioma correcto. */
export function setUserLocale(userId: string, locale: "es" | "de"): void {
  getDb().prepare("UPDATE users SET locale = ? WHERE id = ?").run(locale, userId);
}

export function createUser(input: {
  name: string;
  email: string;
  passwordHash: string;
  city: string;
}): SessionUser {
  const db = getDb();
  assertPublicName(input.name);
  const existing = db.prepare("SELECT 1 FROM users WHERE email = ?").get(input.email);
  if (existing) {
    // Mensaje genérico para no revelar si el correo está registrado.
    throw new ApiError(409, "No se pudo crear la cuenta con esos datos. Si ya tienes cuenta, inicia sesión.");
  }
  const id = `usr_${randomUUID()}`;
  try {
    db.prepare(
      "INSERT INTO users (id, name, email, password_hash, city, bio, created_at) VALUES (?, ?, ?, ?, ?, '', ?)",
    ).run(id, input.name, input.email, input.passwordHash, input.city, nowIso());
  } catch (error) {
    // Dos registros simultáneos con el mismo correo: el segundo recibe 409.
    if (isConstraintError(error)) {
      throw new ApiError(409, "No se pudo crear la cuenta con esos datos. Si ya tienes cuenta, inicia sesión.");
    }
    throw error;
  }
  const user = getUserById(id);
  if (!user) throw new ApiError(500, "No se pudo crear la cuenta.");
  return user;
}

/* ---------------------------- intentos de acceso ---------------------------- */

export function isAuthBlocked(key: string): boolean {
  const db = getDb();
  const since = new Date(Date.now() - AUTH_WINDOW_MS).toISOString();
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM auth_attempts WHERE attempt_key = ? AND created_at > ?")
    .get(key, since) as { count: number };
  return row.count >= AUTH_MAX_FAILURES;
}

export function recordAuthFailure(key: string): void {
  const db = getDb();
  const now = nowIso();
  db.transaction(() => {
    db.prepare("INSERT INTO auth_attempts (attempt_key, created_at) VALUES (?, ?)").run(key, now);
    const stale = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.prepare("DELETE FROM auth_attempts WHERE created_at < ?").run(stale);
  })();
}

export function clearAuthFailures(key: string): void {
  getDb().prepare("DELETE FROM auth_attempts WHERE attempt_key = ?").run(key);
}

export function markEmailVerified(userId: string): void {
  getDb()
    .prepare(
      "UPDATE users SET email_verified_at = COALESCE(email_verified_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?",
    )
    .run(userId);
}

export function changePassword(userId: string, passwordHash: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

/** Nombre, biografía y ciudad: lo único editable publicamente de una cuenta. */
export function updateProfile(
  userId: string,
  input: { name: string; bio: string; city: string; emailNotifications?: boolean },
): SessionUser {
  assertPublicName(input.name);
  const previous = getUserById(userId);
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      "UPDATE users SET name = ?, bio = ?, city = ?, email_notifications = ? WHERE id = ?",
    ).run(
      input.name,
      input.bio,
      input.city,
      input.emailNotifications === false ? 0 : 1,
      userId,
    );
    // Un aviso de «novedades» solo tiene sentido para la ciudad actual.
    if (previous && previous.city !== input.city) {
      db.prepare("DELETE FROM availability_alerts WHERE user_id = ? AND city <> ?").run(
        userId,
        input.city,
      );
    }
  })();
  const user = getUserById(userId);
  if (!user) throw new ApiError(404, "La cuenta no existe.");
  return user;
}

/* ------------------------- claves de cifrado ------------------------- */

/**
 * Clave pública ECDH (P-256) de una cuenta. La clave privada nunca llega al
 * servidor: solo se publica esta mitad para que la otra persona pueda derivar
 * el secreto compartido de la conversación.
 */
export type PublicKeyRecord = { jwk: JsonWebKey; keyId: string };

export function getPublicKeyRecord(userId: string): PublicKeyRecord | null {
  const row = getDb()
    .prepare("SELECT public_key, public_key_id FROM users WHERE id = ?")
    .get(userId) as { public_key: string | null; public_key_id: string | null } | undefined;
  if (!row?.public_key) return null;
  try {
    const jwk = JSON.parse(row.public_key) as JsonWebKey;
    const keyId = row.public_key_id ?? keyIdFromJwk(jwk);
    return { jwk, keyId };
  } catch {
    return null;
  }
}

export function getPublicKey(userId: string): JsonWebKey | null {
  return getPublicKeyRecord(userId)?.jwk ?? null;
}

/**
 * Guarda (o reemplaza) la clave pública de la cuenta y su huella. Devuelve la
 * huella anterior para que la ruta pueda avisar de un cambio de dispositivo.
 */
export function setPublicKey(
  userId: string,
  jwk: JsonWebKey,
): PublicKeyRecord & { previousKeyId: string | null } {
  const record = {
    jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    keyId: keyIdFromJwk(jwk),
  };
  const previous = getPublicKeyRecord(userId);
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE users SET public_key = ?, public_key_id = ?, public_key_at = ?
       WHERE id = ?`,
    )
    .run(JSON.stringify(record.jwk), record.keyId, now, userId);
  return { ...record, previousKeyId: previous?.keyId ?? null };
}

/** True cuando la cuenta ya puede recibir mensajes cifrados. */
export function hasPublicKey(userId: string): boolean {
  return getPublicKey(userId) !== null;
}
