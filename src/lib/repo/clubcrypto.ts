/**
 * Cifrado del foro de los clubes y moderación por revelación.
 *
 * Un mensaje del tablón va cifrado **una vez por dispositivo de cada miembro**:
 * es reparto pairwise sobre el ratchet de v2, no un protocolo de grupo. Cuesta
 * una sesión por pareja y no oculta quién está en el club, pero reutiliza el
 * mismo ratchet auditado en vez de introducir un segundo protocolo que nadie ha
 * auditado para este uso. MLS es el destino cuando los clubes crezcan.
 *
 * Lo que el servidor decide —y es lo único que debe decidir— es quién puede
 * escribir, a qué dispositivos se entrega y quién puede denunciar. Y no puede
 * leer: el texto vive dentro de los sobres.
 *
 * La moderación no tiene llave maestra. Quien denuncia puede **revelar** el
 * mensaje: su cliente vuelve a cifrarlo para el dispositivo de cada moderador y
 * queda registrado quién lo reveló, cuándo y por qué. Es explícito y
 * atribuible; no hay forma de leer el resto del club.
 */
import { randomUUID } from "node:crypto";

import { ApiError } from "../errors";
import { getDb, type Db } from "../db";
import { nowIso } from "./shared";
import { moderatesClub } from "./clubs";
import { notify } from "./notifications";

/** Un sobre de v2: `type` 0 es pre-clave, 1 es mensaje del ratchet. */
export type ClubEnvelope = { recipientDeviceId: string; type: number; body: string };

/**
 * Tope de sobres por mensaje del club.
 *
 * Con `MAX_DEVICES_PER_ACCOUNT` aparatos por persona, 400 sobres dan para unos
 * cien miembros. Un club que lo supere no puede cifrar por aparato: se dice con
 * un mensaje claro en vez de fallar de forma opaca, y la salida es reducir
 * miembros o aparatos —o pasar a MLS, que es la pieza que falta para clubes
 * grandes—.
 */
export const MAX_CLUB_ENVELOPES = 400;

/** ¿El club cabe en un mensaje cifrado por aparato? */
export function clubFitsEncryption(clubId: string, db: Db = getDb()): {
  devices: number;
  limit: number;
  fits: boolean;
} {
  const devices = listClubDevices(clubId, db).length;
  return { devices, limit: MAX_CLUB_ENVELOPES, fits: devices <= MAX_CLUB_ENVELOPES };
}

export type ClubDevice = {
  userId: string;
  name: string;
  deviceId: string;
  identityKey: string;
  signingKey: string;
};

/**
 * Dispositivos de todos los miembros activos, que es a quienes hay que cifrar.
 *
 * Incluye al propio autor: sus otros aparatos también tienen que poder leer lo
 * que escribe, y su dispositivo actual ya se lo guarda el cliente al enviar.
 */
export function listClubDevices(clubId: string, db: Db = getDb()): ClubDevice[] {
  const club = db
    .prepare("SELECT id FROM clubs WHERE id = ? AND status = 'visible'")
    .get(clubId) as { id: string } | undefined;
  if (!club) throw new ApiError(404, "El club no existe.");

  const rows = db
    .prepare(
      `SELECT u.id AS user_id, u.name, d.device_id, d.identity_key, d.signing_key
         FROM club_members m
         JOIN users u ON u.id = m.user_id
         JOIN device_keys d ON d.user_id = u.id AND d.revoked_at IS NULL
        WHERE m.club_id = ? AND m.status = 'member' AND u.is_suspended = 0
        ORDER BY u.id, d.device_id`,
    )
    .all(clubId) as {
    user_id: string;
    name: string;
    device_id: string;
    identity_key: string;
    signing_key: string;
  }[];

  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    deviceId: row.device_id,
    identityKey: row.identity_key,
    signingKey: row.signing_key,
  }));
}

/**
 * Comprueba que cada sobre va a un dispositivo de un miembro, sin repetir.
 *
 * Sin esta comprobación se podría escribir un mensaje «para» un dispositivo de
 * fuera del club: ese alguien leería el contenido y los miembros no.
 */
function assertEnvelopes(clubId: string, envelopes: ClubEnvelope[], db: Db): void {
  if (envelopes.length > MAX_CLUB_ENVELOPES) {
    throw new ApiError(413, "Demasiados dispositivos en un solo mensaje.");
  }
  if (listClubDevices(clubId, db).length > MAX_CLUB_ENVELOPES) {
    throw new ApiError(
      409,
      "Este club ha crecido por encima de lo que admite el cifrado por aparato. Pide a quien lo lleva que retire miembros inactivos o aparatos, o divide el club.",
    );
  }
  const allowed = new Set(listClubDevices(clubId, db).map((device) => device.deviceId));
  const seen = new Set<string>();
  for (const envelope of envelopes) {
    if (!allowed.has(envelope.recipientDeviceId)) {
      throw new ApiError(400, "Hay un sobre dirigido a un dispositivo que no es del club.");
    }
    if (seen.has(envelope.recipientDeviceId)) {
      throw new ApiError(400, "Hay dos sobres para el mismo dispositivo.");
    }
    seen.add(envelope.recipientDeviceId);
  }
}

/** Guarda los sobres de un mensaje del tablón. Uno por dispositivo. */
export function storeClubEnvelopes(
  postId: string,
  clubId: string,
  envelopes: ClubEnvelope[],
  db: Db = getDb(),
): number {
  if (envelopes.length === 0) return 0;
  assertEnvelopes(clubId, envelopes, db);

  const owner = db.prepare(
    `SELECT 1 AS hay FROM club_members m
      WHERE m.club_id = ? AND m.user_id = ? AND m.status = 'member'`,
  );
  const insert = db.prepare(
    `INSERT INTO club_post_envelopes
       (post_id, recipient_user_id, recipient_device_id, type, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = nowIso();

  return db.transaction(() => {
    let stored = 0;
    for (const envelope of envelopes) {
      const row = db
        .prepare(
          `SELECT user_id FROM device_keys
            WHERE device_id = ? AND revoked_at IS NULL`,
        )
        .get(envelope.recipientDeviceId) as { user_id: string } | undefined;
      if (!row) throw new ApiError(409, "Hay un dispositivo que ya no existe.");
      if (!owner.get(clubId, row.user_id)) {
        throw new ApiError(400, "Hay un sobre dirigido a alguien que no es del club.");
      }
      insert.run(postId, row.user_id, envelope.recipientDeviceId, envelope.type, envelope.body, now);
      stored += 1;
    }
    return stored;
  })();
}

/**
 * Sobres de los mensajes del tablón para **un dispositivo** de quien mira.
 *
 * Los de otro aparato de la misma cuenta no son suyos y no se devuelven: cada
 * dispositivo abre los suyos.
 */
export function listClubEnvelopes(
  clubId: string,
  viewerId: string,
  deviceId: string,
  db: Db = getDb(),
): { postId: string; type: number | null; body: string }[] {
  const rows = db
    .prepare(
      `SELECT e.post_id, e.type, e.body
         FROM club_post_envelopes e
         JOIN club_posts p ON p.id = e.post_id
        WHERE p.club_id = ? AND e.recipient_user_id = ? AND e.recipient_device_id = ?
        ORDER BY p.created_at`,
    )
    .all(clubId, viewerId, deviceId) as { post_id: string; type: number | null; body: string }[];

  return rows.map((row) => ({ postId: row.post_id, type: row.type, body: row.body }));
}

export type Disclosure = {
  id: string;
  postId: string;
  reporterId: string;
  reporterName: string;
  reason: string;
  createdAt: string;
  readAt: string | null;
  envelopes: { type: number | null; body: string }[];
};

/**
 * Revela un mensaje a quien modera el club.
 *
 * Solo puede hacerlo un miembro, y solo sobre un mensaje del club al que
 * pertenece. Los sobres van cifrados a los dispositivos de **cada moderador**:
 * el servidor los guarda sin poder abrirlos y no hay forma de leer nada más.
 *
 * Queda registrado quién reveló qué y por qué, y se avisa a quien modera: una
 * revelación no puede ser anónima ni silenciosa.
 */
export function discloseClubPost(input: {
  clubId: string;
  postId: string;
  reporterId: string;
  reason: string;
  envelopes: ClubEnvelope[];
}): Disclosure {
  const db = getDb();
  const post = db
    .prepare("SELECT id, club_id, author_id, encrypted FROM club_posts WHERE id = ?")
    .get(input.postId) as
    | { id: string; club_id: string; author_id: string; encrypted: number }
    | undefined;
  if (!post || post.club_id !== input.clubId) throw new ApiError(404, "Ese mensaje no existe.");

  const member = db
    .prepare(
      `SELECT 1 AS hay FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'member'`,
    )
    .get(input.clubId, input.reporterId);
  if (!member) throw new ApiError(403, "Solo quien está en el club puede revelar un mensaje.");

  const moderators = db
    .prepare(
      `SELECT c.owner_id AS user_id FROM clubs c WHERE c.id = ?
       UNION
       SELECT m.user_id FROM club_members m
        WHERE m.club_id = ? AND m.status = 'member' AND m.role = 'moderator'`,
    )
    .all(input.clubId, input.clubId) as { user_id: string }[];
  const allowed = new Set(
    db
      .prepare(
        `SELECT d.device_id AS device_id FROM device_keys d
          WHERE d.revoked_at IS NULL AND d.user_id IN (
            SELECT c.owner_id FROM clubs c WHERE c.id = ?
            UNION
            SELECT m.user_id FROM club_members m
             WHERE m.club_id = ? AND m.status = 'member' AND m.role = 'moderator'
          )`,
      )
      .all(input.clubId, input.clubId)
      .map((row) => (row as { device_id: string }).device_id),
  );
  if (input.envelopes.length === 0) {
    throw new ApiError(400, "Falta el contenido revelado.");
  }
  for (const envelope of input.envelopes) {
    if (!allowed.has(envelope.recipientDeviceId)) {
      throw new ApiError(400, "Hay un sobre dirigido a un dispositivo que no modera el club.");
    }
  }

  const id = `cds_${randomUUID()}`;
  const createdAt = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO club_post_disclosures (id, post_id, reporter_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, input.postId, input.reporterId, input.reason, createdAt);
    const insert = db.prepare(
      `INSERT INTO club_post_disclosure_envelopes
         (disclosure_id, recipient_user_id, recipient_device_id, type, body)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const envelope of input.envelopes) {
      const owner = db
        .prepare(
          `SELECT user_id FROM device_keys WHERE device_id = ? AND revoked_at IS NULL`,
        )
        .get(envelope.recipientDeviceId) as { user_id: string } | undefined;
      if (!owner) throw new ApiError(409, "Hay un dispositivo que ya no existe.");
      insert.run(id, owner.user_id, envelope.recipientDeviceId, envelope.type, envelope.body);
    }
  })();

  for (const moderator of moderators) {
    if (moderator.user_id === input.reporterId) continue;
    notify({
      userId: moderator.user_id,
      type: "club",
      title: "Alguien ha revelado un mensaje del club",
      body: "La persona que lo denunció ha compartido el contenido contigo. Solo verás ese mensaje.",
      link: `/clubes/${input.clubId}`,
    });
  }

  return {
    id,
    postId: input.postId,
    reporterId: input.reporterId,
    reporterName: "",
    reason: input.reason,
    createdAt,
    readAt: null,
    envelopes: input.envelopes.map((envelope) => ({ type: envelope.type, body: envelope.body })),
  };
}

/** Revelaciones que puede leer un dispositivo de quien modera. */
export function listDisclosures(
  clubId: string,
  moderatorId: string,
  deviceId: string,
  db: Db = getDb(),
): Disclosure[] {
  if (!moderatesClub(clubId, moderatorId)) {
    throw new ApiError(403, "Solo quien modera el club ve lo que se ha revelado.");
  }
  const rows = db
    .prepare(
      `SELECT d.id, d.post_id, d.reporter_id, d.reason, d.created_at, d.read_at,
              u.name AS reporter_name, e.type, e.body
         FROM club_post_disclosures d
         JOIN club_posts p ON p.id = d.post_id AND p.club_id = ?
         JOIN users u ON u.id = d.reporter_id
         LEFT JOIN club_post_disclosure_envelopes e
           ON e.disclosure_id = d.id AND e.recipient_device_id = ?
        ORDER BY d.created_at DESC`,
    )
    .all(clubId, deviceId) as {
    id: string;
    post_id: string;
    reporter_id: string;
    reason: string;
    created_at: string;
    read_at: string | null;
    reporter_name: string;
    type: number | null;
    body: string | null;
  }[];

  const grouped = new Map<string, Disclosure>();
  for (const row of rows) {
    const current = grouped.get(row.id) ?? {
      id: row.id,
      postId: row.post_id,
      reporterId: row.reporter_id,
      reporterName: row.reporter_name,
      reason: row.reason,
      createdAt: row.created_at,
      readAt: row.read_at,
      envelopes: [],
    };
    if (row.body !== null) {
      current.envelopes.push({ type: row.type, body: row.body });
    }
    grouped.set(row.id, current);
  }
  return [...grouped.values()];
}

/** Marca como leída una revelación de este dispositivo. */
export function markDisclosureRead(disclosureId: string, moderatorId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT d.id FROM club_post_disclosures d
        WHERE d.id = ? AND EXISTS (
          SELECT 1 FROM club_post_disclosure_envelopes e
           WHERE e.disclosure_id = d.id AND e.recipient_user_id = ?
        )`,
    )
    .get(disclosureId, moderatorId);
  if (!row) return false;
  db.prepare("UPDATE club_post_disclosures SET read_at = ? WHERE id = ? AND read_at IS NULL").run(
    nowIso(),
    disclosureId,
  );
  return true;
}

/** Días que se conserva una revelación: el mismo plazo que la auditoría. */
export const DISCLOSURE_RETENTION_DAYS = 730;

/**
 * Purga las revelaciones antiguas.
 *
 * Guardan texto libre de quien denuncia —quién lo dijo y por qué— además de los
 * sobres, así que no se conservan para siempre: a los dos años se borran, que es
 * el plazo que ya se aplica a la auditoría de moderación y a las apelaciones.
 */
export function purgeOldDisclosures(db: Db = getDb(), days = DISCLOSURE_RETENTION_DAYS): number {
  const limite = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare("DELETE FROM club_post_disclosures WHERE created_at < ?").run(limite).changes;
}
