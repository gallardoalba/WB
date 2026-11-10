import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { ApiError } from "../errors";
import type { KeyPlatform, SessionUser } from "../domain";
import { KEY_PLATFORMS } from "../domain";
import { keyIdFromJwk } from "../key-id";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "../locale";
import { verifyPassword } from "../password";
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
  profile_visibility: string;
  city_precision: string;
  sign_as: string;
  dm_policy: string;
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
    // Sin idioma guardado (o con uno desconocido) la cuenta lee en alemán.
    locale: normalizeLocale(row.locale),
    profileVisibility: oneOf(row.profile_visibility, ["members", "followers", "private"], "members"),
    cityPrecision: oneOf(row.city_precision, ["exact", "hidden"], "exact"),
    signAs: oneOf(row.sign_as, ["name", "community"], "name"),
    dmPolicy: oneOf(row.dm_policy, ["mutual", "exchanged"], "mutual"),
  };
}

/** Valor de una columna de preferencias, con caída al valor por defecto. */
function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function getUserById(id: string): SessionUser | null {
  const row = getDb()
    .prepare(
      "SELECT id, name, email, city, bio, is_admin, is_suspended, email_verified_at, email_notifications, locale, profile_visibility, city_precision, sign_as, dm_policy FROM users WHERE id = ?",
    )
    .get(id) as UserRow | undefined;
  return row ? toSessionUser(row) : null;
}

export function getUserWithPassword(
  email: string,
): (SessionUser & { passwordHash: string }) | null {
  const row = getDb()
    .prepare(
      "SELECT id, name, email, city, bio, is_admin, is_suspended, email_verified_at, email_notifications, locale, profile_visibility, city_precision, sign_as, dm_policy, password_hash AS passwordHash FROM users WHERE email = ?",
    )
    .get(email) as (UserRow & { passwordHash: string }) | undefined;
  if (!row) return null;
  return { ...toSessionUser(row), passwordHash: row.passwordHash };
}

/**
 * La cuenta tal y como se le devuelve al cliente: sin el hash de la contraseña.
 *
 * Se escribe campo a campo (y no con `delete` ni con un rest) para que el
 * compilador avise si `SessionUser` gana una propiedad: entonces hay que
 * decidir a mano si esa propiedad puede salir del servidor.
 */
export function publicSessionUser(account: SessionUser & { passwordHash: string }): SessionUser {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    city: account.city,
    bio: account.bio,
    isAdmin: account.isAdmin,
    isSuspended: account.isSuspended,
    emailVerified: account.emailVerified,
    emailNotifications: account.emailNotifications,
    locale: account.locale,
    profileVisibility: account.profileVisibility,
    cityPrecision: account.cityPrecision,
    signAs: account.signAs,
    dmPolicy: account.dmPolicy,
  };
}

/** Guarda el idioma elegido para que los correos salgan en el idioma correcto. */
export function setUserLocale(userId: string, locale: Locale): void {
  getDb().prepare("UPDATE users SET locale = ? WHERE id = ?").run(locale, userId);
}

export function createUser(input: {
  name: string;
  email: string;
  passwordHash: string;
  city: string;
  /** Idioma de la cuenta; si no se indica, el de la plataforma (alemán). */
  locale?: Locale;
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
      "INSERT INTO users (id, name, email, password_hash, city, bio, created_at, locale) VALUES (?, ?, ?, ?, ?, '', ?, ?)",
    ).run(
      id,
      input.name,
      input.email,
      input.passwordHash,
      input.city,
      nowIso(),
      input.locale ?? DEFAULT_LOCALE,
    );
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
 * Clave pública ECDH (P-256) de un dispositivo. La clave privada nunca llega al
 * servidor: solo se publica esta mitad para que la otra persona pueda derivar
 * el secreto compartido de la conversación.
 *
 * Una cuenta puede tener varias (`web` y `android`). Los mensajes llevan un
 * sobre por cada una, así que los dos aparatos leen lo mismo sin compartir la
 * clave privada.
 */
export type PublicKeyRecord = {
  jwk: JsonWebKey;
  keyId: string;
  platform: KeyPlatform;
};

/** Forma pública que viaja en la API. */
export type PublicKeyEntry = {
  platform: KeyPlatform;
  keyId: string;
  publicJwk: JsonWebKey;
};

export function toPublicKeyEntries(records: PublicKeyRecord[]): PublicKeyEntry[] {
  return records.map((record) => ({
    platform: record.platform,
    keyId: record.keyId,
    publicJwk: record.jwk,
  }));
}

/**
 * Claves activas de la cuenta, la ranura web primero: es la que los clientes
 * anteriores a la v40 siguen leyendo como `keyId` único.
 */
export function listPublicKeyRecords(userId: string): PublicKeyRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT platform, key_id, public_jwk FROM user_keys
        WHERE user_id = ?
        ORDER BY CASE platform WHEN 'web' THEN 0 ELSE 1 END, platform`,
    )
    .all(userId) as { platform: string; key_id: string; public_jwk: string }[];
  const records: PublicKeyRecord[] = [];
  for (const row of rows) {
    if (!(KEY_PLATFORMS as readonly string[]).includes(row.platform)) continue;
    try {
      records.push({
        platform: row.platform as KeyPlatform,
        keyId: row.key_id,
        jwk: JSON.parse(row.public_jwk) as JsonWebKey,
      });
    } catch {
      // Una fila corrupta no debe tumbar la conversación entera.
    }
  }
  if (records.length > 0) return records;

  // Base anterior a la v40 sin migrar (o restaurada a mano): la columna antigua
  // era la clave del navegador.
  const legacy = getDb()
    .prepare("SELECT public_key, public_key_id FROM users WHERE id = ?")
    .get(userId) as { public_key: string | null; public_key_id: string | null } | undefined;
  if (!legacy?.public_key) return [];
  try {
    const jwk = JSON.parse(legacy.public_key) as JsonWebKey;
    return [{ platform: "web", keyId: legacy.public_key_id ?? keyIdFromJwk(jwk), jwk }];
  } catch {
    return [];
  }
}

export function getPublicKeyRecord(
  userId: string,
  platform: KeyPlatform = "web",
): PublicKeyRecord | null {
  return listPublicKeyRecords(userId).find((record) => record.platform === platform) ?? null;
}

export function getPublicKey(
  userId: string,
  platform: KeyPlatform = "web",
): JsonWebKey | null {
  return getPublicKeyRecord(userId, platform)?.jwk ?? null;
}

/**
 * Guarda (o reemplaza) la clave pública de **una ranura** y su huella. Devuelve
 * la huella anterior para que la ruta pueda avisar de un cambio de dispositivo.
 */
export function setPublicKey(
  userId: string,
  jwk: JsonWebKey,
  reason: "initial" | "rotation" = "initial",
  platform: KeyPlatform = "web",
): PublicKeyRecord & { previousKeyId: string | null; changed: boolean } {
  const record: PublicKeyRecord = {
    jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    keyId: keyIdFromJwk(jwk),
    platform,
  };
  const previous = getPublicKeyRecord(userId, platform);
  if (previous?.keyId === record.keyId) {
    return { ...record, previousKeyId: previous.keyId, changed: false };
  }

  const db = getDb();
  const now = nowIso();
  db.transaction(() => {
    // Una fila por ranura: publicar en el móvil no toca la clave del navegador.
    db.prepare(
      `INSERT INTO user_keys (user_id, platform, key_id, public_jwk, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, platform) DO UPDATE SET
         key_id = excluded.key_id,
         public_jwk = excluded.public_jwk,
         updated_at = excluded.updated_at`,
    ).run(userId, platform, record.keyId, JSON.stringify(record.jwk), now, now);
    // Cada rotación deja rastro: se cierra la fila abierta y se apunta la nueva.
    db.prepare(
      "UPDATE public_key_history SET replaced_at = ? WHERE user_id = ? AND platform = ? AND replaced_at IS NULL",
    ).run(now, userId, platform);
    db.prepare(
      `INSERT INTO public_key_history (id, user_id, platform, key_id, public_jwk, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `pkh_${randomUUID()}`,
      userId,
      platform,
      record.keyId,
      JSON.stringify(record.jwk),
      reason,
      now,
    );
    if (platform === "web") {
      // Compatibilidad: las consultas y pruebas anteriores leen esta columna.
      db.prepare(
        `UPDATE users SET public_key = ?, public_key_id = ?, public_key_at = ?
         WHERE id = ?`,
      ).run(JSON.stringify(record.jwk), record.keyId, now, userId);
    }
  })();
  return { ...record, previousKeyId: previous?.keyId ?? null, changed: true };
}

/**
 * Publica o **sustituye** la clave de una ranura.
 *
 * La contraseña hace falta en cuanto la cuenta ya tiene **cualquier** clave:
 * tanto para sustituir la de una ranura como para añadir una nueva (la del
 * móvil a una cuenta que solo cifraba en el navegador, o al revés). Así una
 * sesión robada no sirve para instalar la clave del atacante en otro
 * dispositivo y leer los mensajes futuros. Solo la primera clave de una cuenta
 * vacía es TOFU.
 */
export async function changePublicKey(
  userId: string,
  jwk: JsonWebKey,
  options: { password?: string; platform?: KeyPlatform } = {},
): Promise<PublicKeyRecord & { previousKeyId: string | null; changed: boolean }> {
  const platform = options.platform ?? "web";
  const keyId = keyIdFromJwk(jwk);
  const previous = getPublicKeyRecord(userId, platform);
  if (previous?.keyId === keyId) {
    return {
      jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      keyId,
      platform,
      previousKeyId: previous.keyId,
      changed: false,
    };
  }

  // Añadir una ranura a una cuenta que ya cifra es tan sensible como rotarla:
  // con una sesión robada, el atacante instalaría *su* clave en un dispositivo
  // nuevo y leería los mensajes que se cifren a partir de ahí, sin tocar la
  // clave existente (que seguiría funcionando y nadie notaría nada).
  const occupying = listPublicKeyRecords(userId).length > 0;
  if (previous || occupying) {
    if (!options.password) {
      throw new ApiError(
        428,
        previous
          ? "Confirma tu contraseña para cambiar la clave de cifrado."
          : "Confirma tu contraseña para añadir otra clave de cifrado.",
        { details: { rotationRequired: true, newSlot: !previous } },
      );
    }
    const row = getDb()
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(userId) as { password_hash: string } | undefined;
    const valid = row ? await verifyPassword(options.password, row.password_hash) : false;
    if (!valid) {
      throw new ApiError(403, "La contraseña no es correcta.");
    }
  }

  return setPublicKey(userId, jwk, previous ? "rotation" : "initial", platform);
}

/** Personas con un intercambio abierto o cerrado: las que cifran contigo. */
export function listConversationPeers(userId: string, limit = 20): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT CASE WHEN owner_id = ? THEN requester_id ELSE owner_id END AS peer
         FROM requests
        WHERE status IN ('accepted','completed') AND (owner_id = ? OR requester_id = ?)
        LIMIT ?`,
    )
    .all(userId, userId, userId, limit) as { peer: string }[];
  return rows.map((row) => row.peer).filter((peer) => peer !== userId);
}

/** Historial de claves (la más reciente primero). */
export function listPublicKeyHistory(
  userId: string,
  limit = 5,
): {
  keyId: string;
  platform: KeyPlatform;
  reason: string;
  createdAt: string;
  replacedAt: string | null;
}[] {
  const rows = getDb()
    .prepare(
      `SELECT key_id, platform, reason, created_at, replaced_at
         FROM public_key_history WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, limit) as {
    key_id: string;
    platform: string;
    reason: string;
    created_at: string;
    replaced_at: string | null;
  }[];
  return rows.map((row) => ({
    keyId: row.key_id,
    platform: (KEY_PLATFORMS as readonly string[]).includes(row.platform)
      ? (row.platform as KeyPlatform)
      : "web",
    reason: row.reason,
    createdAt: row.created_at,
    replacedAt: row.replaced_at,
  }));
}

/** True cuando la cuenta ya puede recibir mensajes cifrados. */
export function hasPublicKey(userId: string): boolean {
  return listPublicKeyRecords(userId).length > 0;
}

/** Guarda las preferencias de visibilidad (los enums los valida la ruta). */
export function setUserPrivacy(
  userId: string,
  input: {
    profileVisibility: string;
    cityPrecision: string;
    signAs: string;
    dmPolicy: string;
  },
): void {
  getDb()
    .prepare(
      `UPDATE users
          SET profile_visibility = ?, city_precision = ?, sign_as = ?, dm_policy = ?
        WHERE id = ?`,
    )
    .run(input.profileVisibility, input.cityPrecision, input.signAs, input.dmPolicy, userId);
}

/* -------------------------------- sesiones -------------------------------- */

export type SessionInfo = {
  /** Hash del token: sirve para cerrar esa sesión, no para usarla. */
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  /** Navegador o app, ya reducido a una palabra. Cadena vacía si no se sabe. */
  device: string;
  current: boolean;
};

/**
 * Nombre corto de quien abrió la sesión.
 *
 * Se guarda el `User-Agent` completo, pero a la persona se le enseña una
 * palabra: lo que necesita es reconocer el sitio («¿desde el móvil?»), no la
 * cadena entera.
 */
export function describeAgent(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (!ua) return "";
  if (ua.includes("wanderbibliothek-android")) return "App";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad")) return "iOS";
  if (ua.includes("firefox/")) return "Firefox";
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("chrome/") || ua.includes("crios/")) return "Chrome";
  if (ua.includes("safari/")) return "Safari";
  return "Web";
}

/** Sesiones vivas de la cuenta, la usada más recientemente primero. */
export function listSessions(userId: string, currentId: string | null): SessionInfo[] {
  const rows = getDb()
    .prepare(
      `SELECT id, created_at, last_seen_at, expires_at, user_agent
         FROM sessions
        WHERE user_id = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
        ORDER BY COALESCE(last_seen_at, created_at) DESC`,
    )
    .all(userId) as {
    id: string;
    created_at: string;
    last_seen_at: string | null;
    expires_at: string;
    user_agent: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    device: describeAgent(row.user_agent),
    current: currentId !== null && row.id === currentId,
  }));
}

/** Cierra una sesión concreta; el id va con el usuario para que nadie cierre la de otro. */
export function revokeSession(userId: string, sessionId: string): boolean {
  return (
    getDb().prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(sessionId, userId)
      .changes > 0
  );
}

/**
 * Marca el último uso, como mucho cada cinco minutos: escribir en cada petición
 * convertiría la lectura de la sesión en una escritura.
 */
export function touchSession(sessionId: string): void {
  getDb()
    .prepare(
      `UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?
          AND (last_seen_at IS NULL
               OR last_seen_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'))`,
    )
    .run(sessionId);
}
