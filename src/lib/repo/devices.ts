/**
 * Registro de dispositivos del protocolo v2.
 *
 * Solo pasa por aquí material público: la identidad Curve25519 del dispositivo,
 * su clave de firma Ed25519 y las claves de un solo uso que los demás reclaman
 * para abrir una sesión. Las claves privadas viven en el dispositivo y el
 * servidor no las ve nunca.
 *
 * Las claves de un solo uso se entregan **de una en una** y se borran en la
 * misma transacción que las devuelve. Si se reutilizaran, dos sesiones
 * distintas podrían derivar del mismo material.
 */
import { ApiError } from "../errors";
import { getDb, type Db } from "../db";

export type DeviceKey = {
  deviceId: string;
  identityKey: string;
  signingKey: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  oneTimeKeys: number;
};

export type DeviceBundle = {
  deviceId: string;
  identityKey: string;
  signingKey: string;
  /** Clave de un solo uso reclamada; `null` si no queda ninguna. */
  oneTimeKey: { keyId: string; key: string } | null;
};

const SELECT_DEVICE = `SELECT d.user_id, d.device_id, d.identity_key, d.signing_key,
  d.created_at, d.updated_at, d.revoked_at,
  (SELECT COUNT(*) FROM device_one_time_keys k
    WHERE k.user_id = d.user_id AND k.device_id = d.device_id) AS one_time_keys
  FROM device_keys d`;

type DeviceRow = {
  user_id: string;
  device_id: string;
  identity_key: string;
  signing_key: string;
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
  oneTimeKeys: { keyId: string; key: string }[];
};

/**
 * Publica o actualiza un dispositivo.
 *
 * Actualizar la identidad de un dispositivo ya existente es una rotación: la
 * fecha de alta se conserva y `updated_at` cambia, para que el historial de la
 * transparencia muestre cuándo pasó. Las claves de un solo uso se **suman**: un
 * dispositivo que repone claves no pierde las que le quedaban.
 */
export function publishDevice(userId: string, input: PublishDeviceInput, db: Db = getDb()): DeviceKey {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO device_keys
         (user_id, device_id, identity_key, signing_key, created_at, updated_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(user_id, device_id) DO UPDATE SET
         identity_key = excluded.identity_key,
         signing_key = excluded.signing_key,
         updated_at = excluded.updated_at,
         revoked_at = NULL`,
    ).run(userId, input.deviceId, input.identityKey, input.signingKey, now, now);
    const insertar = db.prepare(
      `INSERT OR IGNORE INTO device_one_time_keys (user_id, device_id, key_id, key, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const key of input.oneTimeKeys) {
      insertar.run(userId, input.deviceId, key.keyId, key.key, now);
    }
  })();

  const row = db
    .prepare(`${SELECT_DEVICE} WHERE d.user_id = ? AND d.device_id = ?`)
    .get(userId, input.deviceId) as DeviceRow | undefined;
  if (!row) throw new ApiError(500, "No se pudo guardar el dispositivo.");
  return toDevice(row);
}

/** Dispositivos públicos de una cuenta, sin material de un solo uso. */
export function listDevices(userId: string, db: Db = getDb()): DeviceKey[] {
  const rows = db
    .prepare(`${SELECT_DEVICE} WHERE d.user_id = ? AND d.revoked_at IS NULL ORDER BY d.created_at`)
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
 * Devuelve `null` si el dispositivo no existe o ya no le quedan.
 */
export function claimOneTimeKey(
  userId: string,
  deviceId: string,
  db: Db = getDb(),
): DeviceBundle | null {
  return db.transaction(() => {
    const device = db
      .prepare(
        "SELECT identity_key, signing_key FROM device_keys WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL",
      )
      .get(userId, deviceId) as { identity_key: string; signing_key: string } | undefined;
    if (!device) return null;

    const key = db
      .prepare(
        `DELETE FROM device_one_time_keys
          WHERE rowid = (
            SELECT rowid FROM device_one_time_keys
             WHERE user_id = ? AND device_id = ?
             ORDER BY created_at, key_id LIMIT 1
          )
          RETURNING key_id, key`,
      )
      .get(userId, deviceId) as { key_id: string; key: string } | undefined;

    return {
      deviceId,
      identityKey: device.identity_key,
      signingKey: device.signing_key,
      oneTimeKey: key ? { keyId: key.key_id, key: key.key } : null,
    };
  })();
}
