import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { ApiError } from "../errors";
import type { DirectMessageView, DirectThreadView } from "../domain";
import { notify } from "./notifications";
import { getPublicKeyRecord } from "./users";
import { isBlocked, nowIso } from "./shared";

/**
 * Mensajes directos cifrados entre dos personas.
 *
 * Solo se puede escribir a quien **te sigue y a quien sigues** (seguimiento
 * mutuo): así nadie recibe mensajes de desconocidos. El servidor no puede leer
 * el contenido —solo guarda el sobre— y un hilo nunca existe sin mensajes: se
 * crea al enviar el primero.
 *
 * Las claves del cifrado son las mismas de la mensajería de los intercambios
 * (ECDH P-256 + HKDF + AES-GCM); lo único que cambia es el `info` de la
 * derivación (`dm:<threadId>`), de modo que un hilo directo y una conversación
 * de intercambio con la misma persona nunca comparten clave.
 */

export const DM_MAX_MESSAGES = 200;

type ThreadRow = { id: string; user_a: string; user_b: string };

function pair(userId: string, peerId: string): [string, string] {
  return userId < peerId ? [userId, peerId] : [peerId, userId];
}

/** True cuando las dos personas se siguen (las dos filas de `follows`). */
export function mutualFollow(a: string, b: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND followed_id = ?) AS forward,
         (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND followed_id = ?) AS back`,
    )
    .get(a, b, b, a) as { forward: number; back: number };
  return row.forward > 0 && row.back > 0;
}

function threadRow(userId: string, peerId: string): ThreadRow | null {
  const [user_a, user_b] = pair(userId, peerId);
  const row = getDb()
    .prepare("SELECT id, user_a, user_b FROM dm_threads WHERE user_a = ? AND user_b = ?")
    .get(user_a, user_b) as ThreadRow | undefined;
  return row ?? null;
}

/** Una persona sólo puede participar en sus propios hilos. */
function assertThreadParticipant(thread: ThreadRow, viewerId: string): void {
  if (thread.user_a !== viewerId && thread.user_b !== viewerId) {
    throw new ApiError(403, "Esta conversación no es tuya.");
  }
}

/**
 * Estado del hilo con otra persona. `reason` explica por qué no se puede
 * escribir: falta el seguimiento mutuo, hay un bloqueo o a alguna de las dos
 * partes le falta la clave de cifrado.
 */
export function directThread(viewerId: string, peerId: string): DirectThreadView {
  if (viewerId === peerId) {
    throw new ApiError(409, "No puedes escribirte a ti mismo.");
  }
  const db = getDb();
  const peer = db
    .prepare("SELECT id, name, city, is_suspended FROM users WHERE id = ?")
    .get(peerId) as
    | { id: string; name: string; city: string; is_suspended: number }
    | undefined;
  if (!peer || peer.is_suspended) throw new ApiError(404, "Esa cuenta no existe.");

  const me = db
    .prepare("SELECT id, name FROM users WHERE id = ?")
    .get(viewerId) as { id: string; name: string } | undefined;
  if (!me) throw new ApiError(404, "Tu cuenta no existe.");

  const myKey = getPublicKeyRecord(viewerId);
  const peerKey = getPublicKeyRecord(peerId);
  const blocked = isBlocked(viewerId, peerId) || isBlocked(peerId, viewerId);
  const mutual = mutualFollow(viewerId, peerId);

  const reason: DirectThreadView["reason"] = blocked
    ? "blocked"
    : !mutual
      ? "mutual"
      : !myKey || !peerKey
        ? "no-key"
        : "ok";

  const thread = threadRow(viewerId, peerId);
  const messages = thread ? listDirectMessages(thread.id, viewerId, DM_MAX_MESSAGES) : [];

  return {
    id: thread?.id ?? "",
    peer: {
      id: peer.id,
      name: peer.name,
      city: peer.city,
      keyId: peerKey?.keyId ?? null,
      keyJwk: peerKey?.jwk ?? null,
    },
    me: {
      id: me.id,
      name: me.name,
      keyId: myKey?.keyId ?? null,
      keyJwk: myKey?.jwk ?? null,
    },
    canMessage: reason === "ok",
    reason,
    messages,
  };
}

type MessageRow = {
  id: string;
  sender_id: string;
  ciphertext: string | null;
  iv: string | null;
  key_id: string | null;
  encrypted: number;
  created_at: string;
};

function toMessageView(row: MessageRow, viewerId: string): DirectMessageView {
  return {
    id: row.id,
    senderId: row.sender_id,
    isMine: row.sender_id === viewerId,
    ciphertext: row.ciphertext,
    iv: row.iv,
    keyId: row.key_id,
    encrypted: row.encrypted === 1,
    createdAt: row.created_at,
  };
}

/** Últimos mensajes del hilo, del más antiguo al más reciente. */
export function listDirectMessages(
  threadId: string,
  viewerId: string,
  limit = DM_MAX_MESSAGES,
): DirectMessageView[] {
  const rows = getDb()
    .prepare(
      `SELECT id, sender_id, ciphertext, iv, key_id, encrypted, created_at
         FROM dm_messages
        WHERE thread_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(threadId, limit) as MessageRow[];
  return rows.reverse().map((row) => toMessageView(row, viewerId));
}

/**
 * Guarda un mensaje cifrado. Solo entre seguimientos mutuos, solo con el sobre
 * (el servidor no acepta texto plano, igual que en los intercambios) y con la
 * huella de la clave de quien envía.
 */
export function sendDirectMessage(
  viewerId: string,
  peerId: string,
  input: { ciphertext: string; iv: string; keyId: string },
): DirectMessageView {
  if (!mutualFollow(viewerId, peerId)) {
    throw new ApiError(403, "Solo puedes escribir a quien también te sigue.");
  }
  if (isBlocked(viewerId, peerId) || isBlocked(peerId, viewerId)) {
    throw new ApiError(403, "No puedes escribir a esta persona.");
  }
  const myKey = getPublicKeyRecord(viewerId);
  if (!myKey) {
    throw new ApiError(409, "Publica tu clave de cifrado antes de enviar mensajes.");
  }
  if (myKey.keyId !== input.keyId) {
    throw new ApiError(409, "Tu clave de cifrado ha cambiado: recarga la conversación.");
  }
  if (!getPublicKeyRecord(peerId)) {
    throw new ApiError(409, "La otra persona todavía no ha activado el cifrado.");
  }

  const db = getDb();
  const [user_a, user_b] = pair(viewerId, peerId);
  const now = nowIso();
  const thread = db.transaction(() => {
    let row = threadRow(viewerId, peerId);
    if (!row) {
      const id = `dmt_${randomUUID()}`;
      db.prepare(
        "INSERT INTO dm_threads (id, user_a, user_b, created_at, last_message_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, user_a, user_b, now, now);
      row = { id, user_a, user_b };
    } else {
      db.prepare("UPDATE dm_threads SET last_message_at = ? WHERE id = ?").run(now, row.id);
    }
    const id = `dmm_${randomUUID()}`;
    db.prepare(
      `INSERT INTO dm_messages (id, thread_id, sender_id, body, ciphertext, iv, key_id, encrypted, created_at)
       VALUES (?, ?, ?, '', ?, ?, ?, 1, ?)`,
    ).run(id, row.id, viewerId, input.ciphertext, input.iv, input.keyId, now);
    // Quien escribe ha leído lo suyo.
    markRead(db, row.id, viewerId);
    return { thread: row, messageId: id };
  })();

  notifyDirectMessage(viewerId, peerId);

  const saved = db
    .prepare(
      "SELECT id, sender_id, ciphertext, iv, key_id, encrypted, created_at FROM dm_messages WHERE id = ?",
    )
    .get(thread.messageId) as MessageRow;
  return toMessageView(saved, viewerId);
}

/**
 * Aviso al destinatario, con tope: un hilo activo no puede convertirse en una
 * máquina de notificaciones. Como mucho uno cada 30 minutos por conversación.
 */
function notifyDirectMessage(senderId: string, peerId: string): void {
  const db = getDb();
  const link = `/u/${senderId}?dm=1`;
  const recent = db
    .prepare(
      `SELECT 1 FROM notifications
        WHERE user_id = ? AND link = ?
          AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes')
        LIMIT 1`,
    )
    .get(peerId, link);
  if (recent) return;

  const sender = db.prepare("SELECT name FROM users WHERE id = ?").get(senderId) as
    | { name: string }
    | undefined;
  notify({
    userId: peerId,
    type: "direct",
    title: "Nuevo mensaje directo",
    body: `${sender?.name ?? "Alguien"} te ha escrito.`,
    link,
  });
}

function markRead(db: ReturnType<typeof getDb>, threadId: string, userId: string): void {
  db.prepare(
    `INSERT INTO dm_reads (thread_id, user_id, read_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(thread_id, user_id) DO UPDATE SET read_at = excluded.read_at`,
  ).run(threadId, userId);
}

/** Marca el hilo como leído (para el contador de no leídos). */
export function markDirectThreadRead(viewerId: string, peerId: string): void {
  const thread = threadRow(viewerId, peerId);
  if (!thread) return;
  assertThreadParticipant(thread, viewerId);
  markRead(getDb(), thread.id, viewerId);
}

/** Mensajes sin leer de todas las conversaciones directas. */
export function countUnreadDirectMessages(userId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
    LEFT JOIN dm_reads r ON r.thread_id = t.id AND r.user_id = ?
        WHERE (t.user_a = ? OR t.user_b = ?)
          AND m.sender_id <> ?
          AND (r.read_at IS NULL OR m.created_at > r.read_at)`,
    )
    .get(userId, userId, userId, userId) as { count: number };
  return row.count;
}
