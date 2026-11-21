/**
 * Registro de dispositivos del protocolo v2.
 *
 * Solo pasa por aquí material público: la identidad Curve25519 del dispositivo,
 * su clave de firma Ed25519 y las claves de un solo uso que los demás reclaman
 * para abrir una sesión. Las claves privadas viven en el dispositivo y el
 * servidor no las ve nunca.
 *
 * Dos reglas que sostienen el resto:
 *
 * 1. **Se verifica la firma** del paquete y de cada clave de un solo uso con la
 *    clave Ed25519 del dispositivo. libolm no firma las claves de un solo uso,
 *    así que sin esto el servidor podría entregar una clave suya y quedarse en
 *    medio del establecimiento sin romper ningún MAC.
 * 2. **Las claves de un solo uso se entregan de una en una** y se borran en la
 *    misma transacción que las devuelve. Si se reutilizaran, dos sesiones
 *    distintas podrían derivar del mismo material.
 */
import { ApiError } from "../errors";
import { getDb, type Db } from "../db";
import { bundleMessage, oneTimeKeyMessage } from "../e2e-v2-format";
import { verifyEd25519 } from "../ed25519";
import { verifyPassword } from "../password";

/** Tope de claves de un solo uso por dispositivo: el máximo de libolm. */
export const MAX_ONE_TIME_KEYS = 100;

/**
 * Tope de dispositivos por cuenta.
 *
 * Cada mensaje se cifra una vez por aparato del destinatario y, en un club, una
 * vez por aparato de **cada** miembro: el coste de un mensaje crece con este
 * número. Cinco es de sobra para una persona (móvil, portátil, tableta y dos
 * navegadores) y mantiene el fan-out de un club dentro de lo razonable en un
 * servidor pequeño.
 */
export const MAX_DEVICES_PER_ACCOUNT = 5;

export type DeviceKey = {
  deviceId: string;
  identityKey: string;
  signingKey: string;
  bundleSignature: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  oneTimeKeys: number;
};

export type OneTimeKey = { keyId: string; key: string; signature: string };

export type DeviceBundle = {
  deviceId: string;
  identityKey: string;
  signingKey: string;
  /** Firma del paquete con la clave del propio dispositivo. */
  signature: string;
  /** Clave de un solo uso reclamada; `null` si no queda ninguna. */
  oneTimeKey: OneTimeKey | null;
};

/**
 * Qué ha cambiado al publicar. El llamador decide con esto a quién avisa.
 *
 * - `keys`: reposición corriente de claves de un solo uso.
 * - `initial`: primer dispositivo de la cuenta.
 * - `another`: un dispositivo más en una cuenta que ya tenía alguno.
 * - `identity`: la identidad de un dispositivo existente ha cambiado.
 * - `reactivation`: se devuelve a la vida un dispositivo retirado.
 */
export type PublishChange = "keys" | "initial" | "another" | "identity" | "reactivation";

export type PublishDeviceResult = { device: DeviceKey; change: PublishChange };

const SELECT_DEVICE = `SELECT d.user_id, d.device_id, d.identity_key, d.signing_key,
  d.bundle_signature, d.created_at, d.updated_at, d.revoked_at,
  (SELECT COUNT(*) FROM device_one_time_keys k
    WHERE k.user_id = d.user_id AND k.device_id = d.device_id) AS one_time_keys
  FROM device_keys d`;

type DeviceRow = {
  user_id: string;
  device_id: string;
  identity_key: string;
  signing_key: string;
  bundle_signature: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  one_time_keys: number;
};

function toDevice(row: DeviceRow): DeviceKey {
  return {
    deviceId: row.device_id,
    identityKey: row.identity_key,
    signingKey: row.signing_key,
    bundleSignature: row.bundle_signature,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
    oneTimeKeys: row.one_time_keys,
  };
}

export type PublishDeviceInput = {
  deviceId: string;
  identityKey: string;
  signingKey: string;
  signature: string;
  oneTimeKeys: OneTimeKey[];
};

/**
 * Comprueba que el paquete y sus claves los firmó el dispositivo que dice.
 *
 * La firma no demuestra *quién* es la persona —para eso hace falta fijar la
 * identidad de antes o comparar el número de seguridad—, pero sí que quien
 * publica tiene la clave privada del dispositivo y no solo una sesión robada.
 */
function assertSigned(input: PublishDeviceInput): void {
  const bundleOk = verifyEd25519(
    input.signingKey,
    bundleMessage(input.deviceId, input.identityKey, input.signingKey),
    input.signature,
  );
  if (!bundleOk) throw new ApiError(422, "El paquete del dispositivo no está firmado por su clave.");
  for (const key of input.oneTimeKeys) {
    if (
      verifyEd25519(input.signingKey, oneTimeKeyMessage(input.deviceId, key.keyId, key.key), key.signature)
    ) {
      continue;
    }
    throw new ApiError(422, "Una clave de un solo uso no está firmada por el dispositivo.");
  }
}

/**
 * Publica o actualiza un dispositivo.
 *
 * Reponer claves de un solo uso (lo corriente) no pide nada más: la firma ya
 * demuestra posesión del dispositivo. Dar de alta **otro** dispositivo, cambiar
 * la identidad de uno existente o reactivar uno retirado exige la contraseña,
 * igual que en el protocolo v1: una sesión robada no debe bastar para instalar
 * una clave nueva ni para devolver a la vida un dispositivo que se retiró por
 * pérdida o robo.
 *
 * Al cambiar la identidad se **descartan las claves de un solo uso** anteriores:
 * pertenecen a la cuenta libolm vieja y nadie podría aceptar una sesión con
 * ellas, así que servirlas solo produciría establecimientos imposibles que se
 * confunden con un ataque.
 */
export async function publishDevice(
  userId: string,
  input: PublishDeviceInput,
  options: { password?: string } = {},
  db: Db = getDb(),
): Promise<PublishDeviceResult> {
  assertSigned(input);

  const existing = getDevice(userId, input.deviceId, db);
  // Cuenta también la identidad de v1: una cuenta que ya cifra tiene algo que
  // proteger, aunque todavía no haya publicado ningún dispositivo v2. Sin
  // esto, una sesión robada instalaba el primer dispositivo v2 sin contraseña
  // y recibía el tráfico futuro.
  const hasAnyIdentity =
    listDevices(userId, db, { includeRevoked: true }).length > 0 || hasPublishedKey(userId, db);
  const identityChanged =
    existing !== null &&
    (existing.identityKey !== input.identityKey || existing.signingKey !== input.signingKey);

  let change: PublishChange;
  if (existing?.revokedAt) change = "reactivation";
  else if (identityChanged) change = "identity";
  else if (existing) change = "keys";
  else change = hasAnyIdentity ? "another" : "initial";

  // El **primer** dispositivo de una cuenta es TOFU, igual que la primera clave
  // en v1: no hay nada anterior que proteger. Reponer claves tampoco pide
  // contraseña, porque la firma del paquete ya prueba que lo publica el propio
  // dispositivo. Todo lo demás sí: añadir un dispositivo más, cambiar su
  // identidad o reactivar uno retirado.
  if (change === "another" || change === "identity" || change === "reactivation") {
    await assertPassword(userId, options.password, change, db);
  }

  if (change === "another") assertDeviceRoom(userId, db);

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO device_keys
         (user_id, device_id, identity_key, signing_key, bundle_signature,
          created_at, updated_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(user_id, device_id) DO UPDATE SET
         identity_key = excluded.identity_key,
         signing_key = excluded.signing_key,
         bundle_signature = excluded.bundle_signature,
         updated_at = excluded.updated_at,
         -- Solo una reactivación (con contraseña) devuelve el dispositivo a la
         -- vida. Si la retirada se confirma entre la lectura y la escritura,
         -- este CASE impide que una reposición la deshaga sin contraseña.
         revoked_at = CASE WHEN ? = 1 THEN NULL ELSE device_keys.revoked_at END`,
    ).run(
      userId,
      input.deviceId,
      input.identityKey,
      input.signingKey,
      input.signature,
      now,
      now,
      change === "reactivation" ? 1 : 0,
    );

    if (identityChanged) {
      db.prepare("DELETE FROM device_one_time_keys WHERE user_id = ? AND device_id = ?").run(
        userId,
        input.deviceId,
      );
    }

    const insertar = db.prepare(
      `INSERT INTO device_one_time_keys (user_id, device_id, key_id, key, signature, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, device_id, key_id) DO UPDATE SET
         key = excluded.key,
         signature = excluded.signature`,
    );
    for (const key of input.oneTimeKeys) {
      insertar.run(userId, input.deviceId, key.keyId, key.key, key.signature, now);
    }

    // Tope de claves pendientes: publicar en bucle no debe hacer crecer la
    // tabla sin fin. Se descartan las más antiguas.
    db.prepare(
      `DELETE FROM device_one_time_keys
        WHERE user_id = ? AND device_id = ?
          AND rowid NOT IN (
            SELECT rowid FROM device_one_time_keys
             WHERE user_id = ? AND device_id = ?
             ORDER BY rowid DESC LIMIT ?
          )`,
    ).run(userId, input.deviceId, userId, input.deviceId, MAX_ONE_TIME_KEYS);
  })();

  const row = db
    .prepare(`${SELECT_DEVICE} WHERE d.user_id = ? AND d.device_id = ?`)
    .get(userId, input.deviceId) as DeviceRow | undefined;
  if (!row) throw new ApiError(500, "No se pudo guardar el dispositivo.");
  return { device: toDevice(row), change };
}

/** ¿La cuenta ya publicó alguna identidad? Incluye la ranura v1 y la columna antigua. */
function hasPublishedKey(userId: string, db: Db): boolean {
  const slot = db.prepare("SELECT 1 AS hay FROM user_keys WHERE user_id = ? LIMIT 1").get(userId);
  if (slot) return true;
  const legacy = db
    .prepare("SELECT 1 AS hay FROM users WHERE id = ? AND public_key_id IS NOT NULL")
    .get(userId);
  return Boolean(legacy);
}

/**
 * Un dispositivo más no puede pasar del tope.
 *
 * No es una limitación arbitraria: cada aparato que se añade multiplica el
 * trabajo y el almacenamiento de todos los mensajes que recibe, y en un club lo
 * multiplica por cada miembro. Se cuentan los activos; los retirados no ocupan
 * sitio hasta que se reactivan, y eso ya pide contraseña.
 */
function assertDeviceRoom(userId: string, db: Db): void {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS total FROM device_keys WHERE user_id = ? AND revoked_at IS NULL",
    )
    .get(userId) as { total: number };
  if (row.total < MAX_DEVICES_PER_ACCOUNT) return;
  throw new ApiError(
    409,
    `Puedes tener como mucho ${MAX_DEVICES_PER_ACCOUNT} dispositivos activos. Retira uno desde «Mi cuenta» antes de añadir otro.`,
  );
}

async function assertPassword(
  userId: string,
  password: string | undefined,
  change: PublishChange,
  db: Db,
): Promise<void> {
  const reason: Record<"another" | "identity" | "reactivation", string> = {
    another: "Confirma tu contraseña para añadir otro dispositivo de cifrado.",
    identity: "Confirma tu contraseña para cambiar la identidad de un dispositivo.",
    reactivation: "Confirma tu contraseña para reactivar un dispositivo retirado.",
  };
  if (!password) {
    throw new ApiError(428, reason[change as keyof typeof reason], {
      details: { passwordRequired: true, change },
    });
  }
  const row = db
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(userId) as { password_hash: string } | undefined;
  const valid = row ? await verifyPassword(password, row.password_hash) : false;
  if (!valid) throw new ApiError(403, "La contraseña no es correcta.");
}

/**
 * Dispositivos públicos de una cuenta, sin material de un solo uso.
 *
 * No se publican los de una cuenta suspendida: si la cuenta no puede escribir,
 * tampoco debe poder recibir mensajes nuevos.
 */
export function listDevices(
  userId: string,
  db: Db = getDb(),
  options: { includeRevoked?: boolean } = {},
): DeviceKey[] {
  const condiciones = ["d.user_id = ?"];
  if (!options.includeRevoked) condiciones.push("d.revoked_at IS NULL");
  if (!options.includeRevoked) {
    condiciones.push(
      "EXISTS (SELECT 1 FROM users u WHERE u.id = d.user_id AND u.is_suspended = 0)",
    );
  }
  const rows = db
    .prepare(`${SELECT_DEVICE} WHERE ${condiciones.join(" AND ")} ORDER BY d.created_at`)
    .all(userId) as DeviceRow[];
  return rows.map(toDevice);
}

export function getDevice(userId: string, deviceId: string, db: Db = getDb()): DeviceKey | null {
  const row = db
    .prepare(`${SELECT_DEVICE} WHERE d.user_id = ? AND d.device_id = ?`)
    .get(userId, deviceId) as DeviceRow | undefined;
  return row ? toDevice(row) : null;
}

/**
 * Revoca un dispositivo: deja de publicarse y pierde sus claves pendientes.
 *
 * No se borra la fila: el historial de la transparencia tiene que poder decir
 * que ese dispositivo existió y cuándo dejó de ser válido.
 */
export function revokeDevice(userId: string, deviceId: string, db: Db = getDb()): boolean {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const { changes } = db
      .prepare(
        "UPDATE device_keys SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL",
      )
      .run(now, now, userId, deviceId);
    if (changes === 1) {
      db.prepare("DELETE FROM device_one_time_keys WHERE user_id = ? AND device_id = ?").run(
        userId,
        deviceId,
      );
    }
    return changes === 1;
  })();
}

/**
 * Entrega una clave de un solo uso y la borra.
 *
 * El `DELETE … RETURNING` de SQLite hace las dos cosas en la misma sentencia,
 * así que dos peticiones simultáneas no pueden quedarse con la misma clave.
 * Devuelve `null` si el dispositivo no existe, está retirado o su cuenta está
 * suspendida.
 */
export function claimOneTimeKey(
  userId: string,
  deviceId: string,
  db: Db = getDb(),
): DeviceBundle | null {
  return db.transaction(() => {
    const device = db
      .prepare(
        `SELECT d.identity_key, d.signing_key, d.bundle_signature
           FROM device_keys d
           JOIN users u ON u.id = d.user_id
          WHERE d.user_id = ? AND d.device_id = ?
            AND d.revoked_at IS NULL AND u.is_suspended = 0`,
      )
      .get(userId, deviceId) as
      | { identity_key: string; signing_key: string; bundle_signature: string }
      | undefined;
    if (!device) return null;

    const key = db
      .prepare(
        `DELETE FROM device_one_time_keys
          WHERE rowid = (
            SELECT rowid FROM device_one_time_keys
             WHERE user_id = ? AND device_id = ?
             ORDER BY created_at, key_id LIMIT 1
          )
          RETURNING key_id, key, signature`,
      )
      .get(userId, deviceId) as { key_id: string; key: string; signature: string } | undefined;

    return {
      deviceId,
      identityKey: device.identity_key,
      signingKey: device.signing_key,
      signature: device.bundle_signature,
      oneTimeKey: key ? { keyId: key.key_id, key: key.key, signature: key.signature } : null,
    };
  })();
}
