/**
 * Transporte de los sobres del protocolo v2.
 *
 * El servidor **no puede abrir** el cuerpo: guarda `type` y `body` tal cual y los
 * entrega al dispositivo al que van dirigidos. Lo que sí decide —y es lo único
 * que debe decidir— es si quien escribe participa en la conversación y si el
 * destinatario es la otra parte, y a qué dispositivo pertenece cada sobre.
 *
 * El remitente no se guarda como «quien dice ser»: se guarda la cuenta de la
 * sesión y el dispositivo que firma. El receptor no se fía de ninguno de los
 * dos para la criptografía —saca la clave de identidad del registro firmado y la
 * verifica—, pero sí para no dejar que alguien escriba en un hilo ajeno.
 */
import { ApiError } from "../errors";
import { getDb, type Db } from "../db";

/** Tope de sobres por envío: un mensaje y sus dispositivos, no un volcado. */
export const MAX_ENVELOPES_PER_SEND = 200;
/** Días que se conserva un sobre sin recoger. */
export const ENVELOPE_RETENTION_DAYS = 30;

export type NewEnvelope = {
  recipientDeviceId: string;
  type: number;
  body: string;
};

export type DeviceEnvelope = {
  id: string;
  conversation: string;
  senderUserId: string;
  senderDeviceId: string;
  type: number;
  body: string;
  createdAt: string;
};

/**
 * Conversación canónica: `request:<id>` o `dm:<id>`.
 *
 * El formato importa porque es lo que ata el sobre a su hilo: el cliente lo
 * cifra dentro del mensaje, así que aquí solo se comprueba que existe y que
 * quien escribe participa.
 */
const CONVERSATION_PATTERN = /^(request|dm):([A-Za-z0-9_-]{3,64})$/;

export function parseConversation(conversation: string): { kind: "request" | "dm"; id: string } | null {
  const match = CONVERSATION_PATTERN.exec(conversation);
  if (!match) return null;
  return { kind: match[1] as "request" | "dm", id: match[2]! };
}

/**
 * La otra parte de la conversación, o `null` si quien pregunta no está en ella.
 *
 * Se resuelve en SQL: un id ajeno responde «no existe» sin revelar que existe.
 */
export function conversationPeer(
  conversation: string,
  userId: string,
  db: Db = getDb(),
): string | null {
  const parsed = parseConversation(conversation);
  if (!parsed) return null;

  if (parsed.kind === "request") {
    const row = db
      .prepare(
        `SELECT requester_id, owner_id FROM requests
          WHERE id = ? AND (requester_id = ? OR owner_id = ?)`,
      )
      .get(parsed.id, userId, userId) as
      | { requester_id: string; owner_id: string }
      | undefined;
    if (!row) return null;
    return row.requester_id === userId ? row.owner_id : row.requester_id;
  }

  const row = db
    .prepare(
      `SELECT user_a, user_b FROM dm_threads
        WHERE id = ? AND (user_a = ? OR user_b = ?)`,
    )
    .get(parsed.id, userId, userId) as { user_a: string; user_b: string } | undefined;
  if (!row) return null;
  return row.user_a === userId ? row.user_b : row.user_a;
}

/**
 * Guarda un lote de sobres para los dispositivos de la otra parte.
 *
 * Todo o nada: si un dispositivo destinatario no existe (o ya no está activo),
 * el lote entero se rechaza y el cliente puede reclamar claves nuevas. Guardar
 * medio lote dejaría una conversación a medias sin que nadie lo sepa.
 *
 * El dispositivo del remitente tiene que ser suyo: una sesión robada no debe
 * poder escribir como otro dispositivo de la misma cuenta.
 */
export function storeEnvelopes(
  senderUserId: string,
  senderDeviceId: string,
  conversation: string,
  envelopes: NewEnvelope[],
  db: Db = getDb(),
): number {
  if (envelopes.length === 0) return 0;
  if (envelopes.length > MAX_ENVELOPES_PER_SEND) {
    throw new ApiError(413, "Demasiados sobres en un solo envío.");
  }

  const peer = conversationPeer(conversation, senderUserId, db);
  if (!peer) throw new ApiError(404, "Esa conversación no existe.");

  const now = new Date().toISOString();
  return db.transaction(() => {
    const propio = db
      .prepare(
        `SELECT 1 AS hay FROM device_keys
          WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
            AND EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.is_suspended = 0)`,
      )
      .get(senderUserId, senderDeviceId, senderUserId);
    if (!propio) throw new ApiError(403, "Ese dispositivo no está activo.");

    const destinatario = db.prepare(
      `SELECT 1 AS hay FROM device_keys
        WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.is_suspended = 0)`,
    );
    const insertar = db.prepare(
      `INSERT INTO device_envelopes
         (id, conversation, sender_user_id, sender_device_id,
          recipient_user_id, recipient_device_id, type, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const envelope of envelopes) {
      const hay = destinatario.get(peer, envelope.recipientDeviceId, peer);
      if (!hay) throw new ApiError(409, "La otra parte tiene un dispositivo que ya no existe.");
      insertar.run(
        `env_${crypto.randomUUID()}`,
        conversation,
        senderUserId,
        senderDeviceId,
        peer,
        envelope.recipientDeviceId,
        envelope.type,
        envelope.body,
        now,
      );
    }
    return envelopes.length;
  })();
}

/**
 * Sobres pendientes de un dispositivo propio.
 *
 * Solo se entregan los del dispositivo que pide: el de la otra parte no es
 * suyo, aunque sea la misma cuenta.
 */
export function listEnvelopes(
  userId: string,
  deviceId: string,
  conversation: string,
  db: Db = getDb(),
  limit = 200,
): DeviceEnvelope[] {
  const peer = conversationPeer(conversation, userId, db);
  if (!peer) throw new ApiError(404, "Esa conversación no existe.");

  const rows = db
    .prepare(
      `SELECT id, conversation, sender_user_id, sender_device_id, type, body, created_at
         FROM device_envelopes
        WHERE recipient_user_id = ? AND recipient_device_id = ? AND conversation = ?
        ORDER BY created_at, rowid
        LIMIT ?`,
    )
    .all(userId, deviceId, conversation, limit) as {
    id: string;
    conversation: string;
    sender_user_id: string;
    sender_device_id: string;
    type: number;
    body: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    conversation: row.conversation,
    senderUserId: row.sender_user_id,
    senderDeviceId: row.sender_device_id,
    type: row.type,
    body: row.body,
    createdAt: row.created_at,
  }));
}

/**
 * Confirma los sobres ya descifrados y los borra.
 *
 * La confirmación es del cliente, no del `GET`: si el servidor borrara al
 * entregar, un corte de red perdería mensajes. Un sobre confirmado que se
 * reintente ya no existe, y el ratchet rechazaría el repetido de todos modos.
 */
export function ackEnvelopes(userId: string, deviceId: string, ids: string[], db: Db = getDb()): number {
  if (ids.length === 0) return 0;
  const borrar = db.prepare(
    "DELETE FROM device_envelopes WHERE id = ? AND recipient_user_id = ? AND recipient_device_id = ?",
  );
  return db.transaction(() => {
    let borrados = 0;
    for (const id of ids) borrados += borrar.run(id, userId, deviceId).changes;
    return borrados;
  })();
}

/** Purga de sobres viejos; la llama el cron de mantenimiento. */
export function purgeOldEnvelopes(db: Db = getDb(), days = ENVELOPE_RETENTION_DAYS): number {
  const limite = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare("DELETE FROM device_envelopes WHERE created_at < ?").run(limite).changes;
}

/** Cuántos sobres esperan en un dispositivo: sirve para el aviso de «no leído». */
export function countPendingEnvelopes(userId: string, deviceId: string, db: Db = getDb()): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS total FROM device_envelopes WHERE recipient_user_id = ? AND recipient_device_id = ?",
    )
    .get(userId, deviceId) as { total: number };
  return row.total;
}
