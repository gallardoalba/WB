import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { ApiError } from "../errors";
import { INCIDENT_WINDOW_DAYS } from "../domain";
import type {
  ListingStatus,
  MessageEnvelopeView,
  MessageView,
  NotificationView,
  RequestStatus,
  RequestView,
  ViewerRole,
} from "../domain";
import { publishRequestMessage } from "../live";
import { canTransition, listingStatusFor } from "../request-flow";
import { normalizeCoverUrl, normalizeText } from "../text";
import {
  areBlocked,
  assertNoV1WhenV2,
  assertV1StillAllowed,
  assertV2Envelopes,
  FALTAN_SOBRES,
  messageEnvelopesFor,
  nowIso,
  type V2MessageInput,
} from "./shared";
import {
  assertVerified,
  getUserById,
  hasPublicKey,
  listPublicKeyRecords,
  toPublicKeyEntries,
} from "./users";
import { listingTitle, notify } from "./notifications";

type RequestRow = {
  id: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  listing_id: string;
  title: string;
  author: string;
  cover_url: string | null;
  listing_status: ListingStatus;
  requester_id: string;
  requester_name: string;
  requester_city: string;
  requester_city_precision: string;
  owner_id: string;
  owner_name: string;
  owner_city: string;
  owner_city_precision: string;
  owner_confirmed_at: string | null;
  requester_confirmed_at: string | null;
  accepted_at: string | null;
  incident_reporter_id: string | null;
  incident_response: string | null;
  incident_opened_at: string | null;
  incident_can_open: number;
  message_count: number;
  last_message_at: string | null;
  unread_messages: number;
  reviewed: number;
  archived: number;
};

/**
 * Qué hacer con los intercambios archivados por quien mira.
 *
 * `active` es la lista normal (lo que queda por hacer y el historial reciente);
 * `archived` es el cajón, y `all` solo lo usan los recuentos de la cuenta, que
 * no deben bajar porque alguien archive un intercambio cerrado.
 */
export type RequestArchiveFilter = "active" | "archived" | "all";

function archiveClause(filter: RequestArchiveFilter): string {
  if (filter === "all") return "";
  const exists = `EXISTS (SELECT 1 FROM request_archives ra
                          WHERE ra.request_id = r.id AND ra.user_id = @userId)`;
  return filter === "archived" ? `AND ${exists}` : `AND NOT ${exists}`;
}

const REQUEST_SELECT = `
  SELECT r.id, r.status, r.created_at, r.updated_at, r.accepted_at, r.listing_id,
         r.owner_confirmed_at, r.requester_confirmed_at,
         inc.reporter_id AS incident_reporter_id,
         inc.response AS incident_response,
         inc.created_at AS incident_opened_at,
         CASE WHEN r.requester_id = @viewerId
                   AND r.status = 'accepted'
                   AND r.requester_confirmed_at IS NULL
                   AND inc.id IS NULL
                   AND datetime(COALESCE(r.accepted_at, r.created_at), '+${INCIDENT_WINDOW_DAYS} days')
                       >= datetime('now')
              THEN 1 ELSE 0 END AS incident_can_open,
         b.title, b.author, b.cover_url, l.status AS listing_status,
         req.id AS requester_id, req.name AS requester_name, req.city AS requester_city,
         req.city_precision AS requester_city_precision,
         own.id AS owner_id, own.name AS owner_name, own.city AS owner_city,
         own.city_precision AS owner_city_precision,
         (SELECT COUNT(*) FROM messages m WHERE m.request_id = r.id) AS message_count,
         (SELECT MAX(m.created_at) FROM messages m WHERE m.request_id = r.id) AS last_message_at,
         (SELECT COUNT(*) FROM messages m
           WHERE m.request_id = r.id AND m.sender_id <> @viewerId
             AND m.created_at > COALESCE(
               (SELECT rr.read_at FROM request_reads rr
                 WHERE rr.request_id = r.id AND rr.user_id = @viewerId), '')) AS unread_messages,
         (SELECT COUNT(*) FROM reviews rv WHERE rv.request_id = r.id AND rv.author_id = @viewerId) AS reviewed,
         EXISTS (SELECT 1 FROM request_archives ra
                  WHERE ra.request_id = r.id AND ra.user_id = @viewerId) AS archived
  FROM requests r
  JOIN listings l ON l.id = r.listing_id
  JOIN books b ON b.id = l.book_id
  JOIN users req ON req.id = r.requester_id
  JOIN users own ON own.id = r.owner_id
  LEFT JOIN reports inc ON inc.id = (
    SELECT rp.id FROM reports rp
     WHERE rp.target_type = 'request'
       AND rp.target_id = r.id
       AND rp.status = 'open'
       AND rp.reason = 'El libro no llegó'
     ORDER BY rp.created_at DESC
     LIMIT 1
  )
`;

function toRequestView(row: RequestRow, viewerId: string): RequestView {
  // La ciudad es un dato personal y hay quien prefiere no enseñarla. Se oculta
  // salvo a quien la publicó y salvo cuando el intercambio ya está aceptado:
  // sin saber dónde está la otra persona no se puede quedar.
  const cerrado = row.status === "accepted" || row.status === "completed";
  const city = (value: string, precision: string, isSelf: boolean) =>
    isSelf || cerrado || precision !== "hidden" ? value : "";

  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
    role: row.requester_id === viewerId ? "requester" : "owner",
    listing: {
      id: row.listing_id,
      title: row.title,
      author: row.author,
      // Misma regla que en el catálogo: una portada antigua (de Open Library o
      // servida por ISBN) se anula al leer.
      coverUrl: normalizeCoverUrl(row.cover_url),
      status: row.listing_status,
    },
    requester: {
      id: row.requester_id,
      name: row.requester_name,
      city: city(row.requester_city, row.requester_city_precision, row.requester_id === viewerId),
    },
    owner: {
      id: row.owner_id,
      name: row.owner_name,
      city: city(row.owner_city, row.owner_city_precision, row.owner_id === viewerId),
    },
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    unreadMessages: row.unread_messages,
    reviewed: row.reviewed > 0,
    archived: row.archived > 0,
    confirmedByMe: Boolean(
      row.requester_id === viewerId ? row.requester_confirmed_at : row.owner_confirmed_at,
    ),
    confirmedByOther: Boolean(
      row.requester_id === viewerId ? row.owner_confirmed_at : row.requester_confirmed_at,
    ),
    incidentOpen: Boolean(row.incident_reporter_id),
    incidentCanOpen: Boolean(row.incident_can_open),
    incidentReportedByMe: row.incident_reporter_id === viewerId,
    incidentCanRespond:
      Boolean(row.incident_reporter_id) && row.incident_reporter_id !== viewerId,
    incidentResponded: Boolean(row.incident_response?.trim()),
    // La versión de la otra parte es para moderación; no se le devuelve a
    // quien abrió la incidencia.
    incidentResponse:
      row.incident_reporter_id && row.incident_reporter_id !== viewerId
        ? row.incident_response
        : null,
    incidentOpenedAt: row.incident_opened_at,
  };
}

/** Marca la conversación como leída hasta ahora para esa persona. */
export function markRequestRead(userId: string, requestId: string): void {
  // Sin esta comprobación cualquier cuenta podía escribir filas de lectura
  // para solicitudes ajenas (basura en la tabla, sin filtrar contenido).
  assertParticipant(requestId, userId);
  getDb()
    .prepare(
      `INSERT INTO request_reads (request_id, user_id, read_at) VALUES (?, ?, ?)
       ON CONFLICT(request_id, user_id) DO UPDATE SET read_at = excluded.read_at`,
    )
    .run(requestId, userId, nowIso());
}

/**
 * Intercambios abiertos de una cuenta. Se usa para el contador del menú: es
 * una consulta barata y evita cargar la lista completa en cada vista.
 */
export function countActiveRequests(userId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM requests
        WHERE (owner_id = ? OR requester_id = ?) AND status IN ('pending','accepted')`,
    )
    .get(userId, userId) as { count: number };
  return row.count;
}

/** Total de mensajes sin leer en todas las conversaciones. */
export function countUnreadMessages(userId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM messages m
       JOIN requests r ON r.id = m.request_id
       WHERE (r.requester_id = ? OR r.owner_id = ?) AND m.sender_id <> ?
         AND m.created_at > COALESCE(
           (SELECT rr.read_at FROM request_reads rr
             WHERE rr.request_id = m.request_id AND rr.user_id = ?), '')`,
    )
    .get(userId, userId, userId, userId) as { count: number };
  return row.count;
}

export function listRequests(
  userId: string,
  options: { archived?: RequestArchiveFilter } = {},
): RequestView[] {
  return listRequestsPage(userId, {
    limit: REQUEST_PAGE_MAX,
    archived: options.archived ?? "active",
  }).items;
}

/** Tope de una página del historial (lo que devuelve la vista completa). */
export const REQUEST_PAGE_MAX = 500;

/**
 * Total de intercambios de una cuenta, para saber si la lista viene recortada.
 *
 * Por omisión cuenta los que esa persona no ha archivado: es el número que
 * acompaña a la lista visible. `all` sirve para los recuentos de la cuenta.
 */
export function countRequests(
  userId: string,
  options: { archived?: RequestArchiveFilter } = {},
): number {
  const filter = options.archived ?? "active";
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM requests r
        WHERE (r.requester_id = @userId OR r.owner_id = @userId)
          ${archiveClause(filter)}`,
    )
    .get({ userId }) as { count: number };
  return row.count;
}

/**
 * Una página del historial, ordenada por actividad reciente.
 *
 * El cursor es `(updated_at, id)` y no un `offset`: la lista se ordena por la
 * última actividad, así que un mensaje nuevo mueve las filas y un `OFFSET`
 * repetiría o saltaría intercambios entre dos páginas. Con el par completo,
 * `id` desempata los que comparten marca de tiempo.
 */
export function listRequestsPage(
  userId: string,
  options: {
    limit?: number;
    before?: { updatedAt: string; id: string };
    archived?: RequestArchiveFilter;
  } = {},
): { items: RequestView[]; hasMore: boolean; next: { updatedAt: string; id: string } | null } {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), REQUEST_PAGE_MAX);
  const before = options.before;
  const filas = getDb()
    .prepare(
      `${REQUEST_SELECT}
        WHERE (r.requester_id = @userId OR r.owner_id = @userId)
          ${archiveClause(options.archived ?? "active")}
          AND (@antes IS NULL
               OR r.updated_at < @antes
               OR (r.updated_at = @antes AND r.id < @antesId))
        ORDER BY r.updated_at DESC, r.id DESC
        LIMIT @limite`,
    )
    .all({
      userId,
      viewerId: userId,
      antes: before?.updatedAt ?? null,
      antesId: before?.id ?? null,
      // Una fila de más para saber si queda algo sin hacer otro COUNT.
      limite: limit + 1,
    }) as RequestRow[];

  const hayMas = filas.length > limit;
  const items = (hayMas ? filas.slice(0, limit) : filas).map((row) => toRequestView(row, userId));
  const ultima = items.at(-1);
  return {
    items,
    hasMore: hayMas,
    next: hayMas && ultima ? { updatedAt: ultima.updatedAt, id: ultima.id } : null,
  };
}

/**
 * Una solicitud concreta vista por una de sus dos partes.
 *
 * Se filtra por participante en el SQL, no después: así un id ajeno responde
 * «no existe» sin revelar que existe. La usa la app Android al abrir un hilo.
 */
export function getRequest(requestId: string, userId: string): RequestView | null {
  const row = getDb()
    .prepare(
      `${REQUEST_SELECT}
       WHERE r.id = @requestId
         AND (r.requester_id = @userId OR r.owner_id = @userId)`,
    )
    .get({ requestId, userId, viewerId: userId }) as RequestRow | undefined;
  return row ? toRequestView(row, userId) : null;
}

export function createRequest(
  requesterId: string,
  listingId: string,
  // Compatibilidad con llamadas antiguas: el mensaje inicial ya no se guarda.
  _message = "",
): RequestView {
  void _message;
  assertVerified(requesterId);
  const db = getDb();
  const listing = db
    .prepare(
      `SELECT l.id, l.owner_id, l.status, u.is_suspended AS owner_suspended
       FROM listings l JOIN users u ON u.id = l.owner_id WHERE l.id = ?`,
    )
    .get(listingId) as
    | { id: string; owner_id: string; status: ListingStatus; owner_suspended: number }
    | undefined;

  // Misma visibilidad que el catálogo: un ejemplar de una cuenta suspendida no
  // se puede solicitar aunque alguien conozca su identificador.
  if (!listing || listing.status === "removed" || listing.owner_suspended) {
    throw new ApiError(404, "El ejemplar ya no existe.");
  }
  if (listing.owner_id === requesterId) {
    throw new ApiError(409, "No puedes solicitar tu propio ejemplar.");
  }
  if (listing.status !== "available") {
    throw new ApiError(409, "Este ejemplar ya no está disponible.");
  }
  if (areBlocked(requesterId, listing.owner_id)) {
    throw new ApiError(409, "No puedes contactar con esta persona.");
  }

  const duplicate = db
    .prepare(
      "SELECT 1 FROM requests WHERE listing_id = ? AND requester_id = ? AND status = 'pending'",
    )
    .get(listingId, requesterId);
  if (duplicate) {
    throw new ApiError(409, "Ya has enviado una solicitud para este ejemplar.");
  }

  const id = `req_${randomUUID()}`;
  const now = nowIso();

  try {
    db.transaction(() => {
      db.prepare(
        "INSERT INTO requests (id, listing_id, requester_id, owner_id, message, status, created_at, updated_at) VALUES (?, ?, ?, ?, '', 'pending', ?, ?)",
      ).run(id, listingId, requesterId, listing.owner_id, now, now);
      db.prepare(
        "INSERT INTO events (id, type, actor_id, listing_id, request_id, created_at) VALUES (?, 'requested', ?, ?, ?, ?)",
      ).run(`evt_${randomUUID()}`, requesterId, listingId, id, now);
      const requester = getUserById(requesterId);
      notify({
        userId: listing.owner_id,
        type: "request",
        title: "Nueva solicitud de intercambio",
        body: `${requester?.name ?? "Alguien"} quiere leer «${listingTitle(listingId)}».`,
        listingId,
        requestId: id,
        link: `/intercambios?t=${id}`,
      });
    })();
  } catch (error) {
    if (error instanceof Error && "code" in error && String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      throw new ApiError(409, "Ya has enviado una solicitud para este ejemplar.");
    }
    throw error;
  }

  const row = db.prepare(`${REQUEST_SELECT} WHERE r.id = @id`).get({ id, viewerId: requesterId }) as RequestRow;
  return toRequestView(row, requesterId);
}

const REQUEST_ERRORS: Record<string, string> = {
  accepted: "Solo la persona que ofrece el libro puede aceptar la solicitud.",
  declined: "Solo la persona que ofrece el libro puede rechazar la solicitud.",
  cancelled: "Este cambio no está permitido en el estado actual.",
  completed: "Solo un intercambio aceptado puede marcarse como completado.",
};

/** El estado cambió entre la lectura y la escritura (otra pestaña, otra persona). */
const STALE_REQUEST = "El intercambio ha cambiado mientras lo mirabas. Recarga e inténtalo de nuevo.";

/** Ya hay una entrega confirmada: deshacer el intercambio ya no es una opción. */
const CANCEL_AFTER_CONFIRMATION =
  "Una de las dos personas ya ha confirmado la entrega o la recepción: el intercambio no se puede cancelar.";

/**
 * Copia que estrena quien se queda el libro.
 *
 * El ejemplar que se entrega queda `given` como histórico del intercambio, así
 * que el libro seguiría fuera de circulación para siempre. Aquí nace la copia
 * de quien lo recibe: misma edición y misma condición, en su ciudad y **en
 * pausa**, porque tenerlo no es lo mismo que ofrecerlo. Desde «Mi estantería»
 * puede activarla y el libro vuelve a viajar.
 *
 * Devuelve el id de la copia nueva, o `null` si el ejemplar original ya no
 * existe (por ejemplo, borrado con la cuenta).
 */
function createReceivedCopy(
  requestId: string,
  listingId: string,
  receiverId: string,
): string | null {
  const db = getDb();
  const source = db
    .prepare(
      `SELECT l.book_id, l.condition, b.title, b.author, u.city AS receiver_city
       FROM listings l
       JOIN books b ON b.id = l.book_id
       JOIN users u ON u.id = ?
       WHERE l.id = ?`,
    )
    .get(receiverId, listingId) as
    | { book_id: string; condition: string; title: string; author: string; receiver_city: string }
    | undefined;
  if (!source) return null;

  const id = `lst_${randomUUID()}`;
  // El índice único de `from_request_id` es la última red: si el cierre se
  // repitiera por cualquier vía, no hay dos copias para el mismo intercambio.
  const { changes } = db
    .prepare(
      `INSERT OR IGNORE INTO listings
         (id, book_id, owner_id, condition, city, distance_km, status, search_key,
          notes, created_at, from_listing_id, from_request_id)
       VALUES (?, ?, ?, ?, ?, NULL, 'paused', ?, '', ?, ?, ?)`,
    )
    .run(
      id,
      source.book_id,
      receiverId,
      source.condition,
      source.receiver_city,
      normalizeText(`${source.title} ${source.author} ${source.receiver_city}`),
      nowIso(),
      listingId,
      requestId,
    );
  return changes === 1 ? id : null;
}

export function updateRequestStatus(
  requestId: string,
  userId: string,
  target: RequestStatus,
): RequestView {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, listing_id, requester_id, owner_id, status,
              owner_confirmed_at, requester_confirmed_at
         FROM requests WHERE id = ?`,
    )
    .get(requestId) as
    | {
        id: string;
        listing_id: string;
        requester_id: string;
        owner_id: string;
        status: RequestStatus;
        owner_confirmed_at: string | null;
        requester_confirmed_at: string | null;
      }
    | undefined;

  if (!row) throw new ApiError(404, "La solicitud no existe.");
  if (row.requester_id !== userId && row.owner_id !== userId) {
    throw new ApiError(404, "La solicitud no existe.");
  }
  // Con una confirmación sobre la mesa, el intercambio ya no se deshace: una de
  // las dos personas ha declarado que el libro cambió de manos. Retirarlo desde
  // ahí dejaría el ejemplar libre y la palabra de una de ellas en el aire.
  if (
    (target === "cancelled" || target === "declined") &&
    (row.owner_confirmed_at || row.requester_confirmed_at)
  ) {
    throw new ApiError(409, CANCEL_AFTER_CONFIRMATION);
  }
  const role: ViewerRole = row.requester_id === userId ? "requester" : "owner";
  // Una incidencia de entrega abierta congela el cierre: ni completar ni
  // cancelar. La moderación sí puede resolverla con su propia acción.
  if (target === "completed" || target === "cancelled") {
    const incident = db
      .prepare(
        "SELECT 1 FROM reports WHERE target_type = 'request' AND target_id = ? AND status = 'open' AND reason = 'El libro no llegó'",
      )
      .get(requestId);
    if (incident) {
      throw new ApiError(
        409,
        "Hay una incidencia abierta sobre este intercambio. Espera a que la moderación la resuelva.",
      );
    }
  }
  if (!canTransition(role, row.status, target)) {
    throw new ApiError(409, REQUEST_ERRORS[target] ?? "Ese cambio de estado no es válido.");
  }
  const now = nowIso();

  db.transaction(() => {
    if (target === "completed") {
      // Cierre bilateral: cada parte confirma la entrega por su lado. El
      // intercambio solo pasa a `completed` cuando ambas han confirmado.
      const column = role === "owner" ? "owner_confirmed_at" : "requester_confirmed_at";
      // La escritura se limita al estado leído: si la otra parte canceló entre
      // el SELECT y este punto, la transacción se deshace en vez de resucitar
      // una solicitud cerrada.
      const confirmed = db
        .prepare(
          `UPDATE requests SET ${column} = COALESCE(${column}, ?), updated_at = ?
            WHERE id = ? AND status = ?`,
        )
        .run(now, now, requestId, row.status);
      if (confirmed.changes !== 1) {
        throw new ApiError(409, STALE_REQUEST);
      }
      const confirmations = db
        .prepare(
          "SELECT owner_confirmed_at, requester_confirmed_at FROM requests WHERE id = ?",
        )
        .get(requestId) as {
        owner_confirmed_at: string | null;
        requester_confirmed_at: string | null;
      };
      const otherId = row.requester_id === userId ? row.owner_id : row.requester_id;

      if (confirmations.owner_confirmed_at && confirmations.requester_confirmed_at) {
        const closed = db
          .prepare(
            "UPDATE requests SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'accepted'",
          )
          .run(now, requestId);
        // Ya estaba cerrado (reintento): no se repiten avisos ni copias.
        if (closed.changes !== 1) return;
        // Un ejemplar retirado por moderación no puede «resucitar» al completar,
        // pero tampoco se pierde: quien lo recibe estrena su propia copia.
        db.prepare("UPDATE listings SET status = 'given' WHERE id = ? AND status <> 'removed'").run(
          row.listing_id,
        );
        const receivedId = createReceivedCopy(requestId, row.listing_id, row.requester_id);
        db.prepare(
          "INSERT INTO events (id, type, actor_id, listing_id, request_id, created_at) VALUES (?, 'completed', ?, ?, ?, ?)",
        ).run(`evt_${randomUUID()}`, userId, row.listing_id, requestId, now);
        notify({
          userId: otherId,
          type: "completed",
          title: "Intercambio completado",
          body: `«${listingTitle(row.listing_id)}»`,
          listingId: row.listing_id,
          requestId,
          link: `/intercambios?t=${requestId}`,
        });
        if (receivedId) {
          notify({
            userId: row.requester_id,
            type: "completed",
            title: "El libro ya está en tu estantería",
            body: `«${listingTitle(row.listing_id)}»`,
            listingId: receivedId,
            requestId,
            link: `/intercambios?t=${requestId}`,
          });
        }
      } else {
        // El aviso cambia según lo que le toca hacer a quien lo recibe: al
        // receptor se le pide el recibo; a quien entrega, la entrega. Antes el
        // mismo texto («cuando lo recibas») se enviaba a las dos partes.
        const otherRole = role === "owner" ? "requester" : "owner";
        notify({
          userId: otherId,
          type: "accepted",
          title: otherRole === "requester" ? "Confirma la recepción" : "Confirma la entrega",
          body:
            otherRole === "requester"
              ? `«${listingTitle(row.listing_id)}» · Ya se ha entregado. Cuando lo tengas, confirma que lo has recibido.`
              : `«${listingTitle(row.listing_id)}» · Ya se ha confirmado la recepción. Confirma tú la entrega para cerrar el intercambio.`,
          listingId: row.listing_id,
          requestId,
          link: `/intercambios?t=${requestId}`,
        });
      }
      return;
    }

    if (target === "accepted") {
      // Invariante: un ejemplar solo puede reservarse si sigue disponible.
      const reserved = db
        .prepare("UPDATE listings SET status = 'reserved' WHERE id = ? AND status = 'available'")
        .run(row.listing_id);
      if (reserved.changes !== 1) {
        throw new ApiError(409, "Este ejemplar ya está reservado o entregado.");
      }
      // Las demás solicitudes pendientes dejan de tener sentido.
      db.prepare(
        "UPDATE requests SET status = 'expired', updated_at = ? WHERE listing_id = ? AND status = 'pending' AND id <> ?",
      ).run(now, row.listing_id, requestId);
    }

    {
      // La condición repite en SQL lo que ya se comprobó arriba: si la otra
      // parte confirma entre la lectura y esta escritura, la cancelación no
      // pasa (y el ejemplar no se libera por detrás).
      const guard = target === "cancelled" || target === "declined"
        ? " AND owner_confirmed_at IS NULL AND requester_confirmed_at IS NULL"
        : "";
      const acceptedAt = target === "accepted" ? ", accepted_at = ?" : "";
      const params: unknown[] = [target, now];
      if (target === "accepted") params.push(now);
      params.push(requestId, row.status);
      const updated = db
        .prepare(
          `UPDATE requests SET status = ?, updated_at = ?${acceptedAt} WHERE id = ? AND status = ?${guard}`,
        )
        .run(...params);
      if (updated.changes !== 1) {
        throw new ApiError(409, STALE_REQUEST);
      }
    }

    if (target === "declined" || target === "cancelled") {
      const otherAccepted = db
        .prepare("SELECT 1 FROM requests WHERE listing_id = ? AND status = 'accepted' AND id <> ?")
        .get(row.listing_id, requestId);
      if (!otherAccepted) {
        const listing = db
          .prepare("SELECT status FROM listings WHERE id = ?")
          .get(row.listing_id) as { status: ListingStatus };
        db.prepare("UPDATE listings SET status = ? WHERE id = ?").run(
          listingStatusFor(listing.status, target),
          row.listing_id,
        );
      }
    }

    if (target === "accepted") {
      db.prepare(
        "INSERT INTO events (id, type, actor_id, listing_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(`evt_${randomUUID()}`, target, userId, row.listing_id, requestId, now);
    }

    const otherId = row.requester_id === userId ? row.owner_id : row.requester_id;
    const titles: Record<string, string> = {
      accepted: "Han aceptado tu solicitud",
      declined: "Han rechazado tu solicitud",
      cancelled: "Intercambio cancelado",
    };
    notify({
      userId: otherId,
      type: target as NotificationView["type"],
      title: titles[target] ?? "Intercambio actualizado",
      body: `«${listingTitle(row.listing_id)}»`,
      listingId: row.listing_id,
      requestId,
      link: `/intercambios?t=${requestId}`,
    });
  })();

  const updated = db.prepare(`${REQUEST_SELECT} WHERE r.id = @id`).get({ id: requestId, viewerId: userId }) as RequestRow;
  return toRequestView(updated, userId);
}

/**
 * Archiva o devuelve a la lista un intercambio cerrado, solo para quien lo pide.
 *
 * Archivar no borra ni cambia el estado: es un cajón personal. Por eso se exige
 * que el intercambio haya terminado —cancelado o completado— y que quien lo
 * pide sea una de sus dos partes. Devolverlo a la lista es la misma operación
 * con `archived: false`, para que el arrepentimiento no necesite otra ruta.
 */
export function setRequestArchived(
  requestId: string,
  userId: string,
  archived: boolean,
): RequestView {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT status FROM requests
        WHERE id = ? AND (requester_id = ? OR owner_id = ?)`,
    )
    .get(requestId, userId, userId) as { status: RequestStatus } | undefined;
  if (!row) throw new ApiError(404, "La solicitud no existe.");
  if (row.status !== "completed" && row.status !== "cancelled") {
    throw new ApiError(409, "Solo se archivan los intercambios cancelados o completados.");
  }

  if (archived) {
    db.prepare(
      `INSERT INTO request_archives (request_id, user_id, archived_at) VALUES (?, ?, ?)
       ON CONFLICT(request_id, user_id) DO NOTHING`,
    ).run(requestId, userId, nowIso());
  } else {
    db.prepare("DELETE FROM request_archives WHERE request_id = ? AND user_id = ?").run(
      requestId,
      userId,
    );
  }

  const updated = db
    .prepare(`${REQUEST_SELECT} WHERE r.id = @id`)
    .get({ id: requestId, viewerId: userId }) as RequestRow;
  return toRequestView(updated, userId);
}

/**
 * Cancela los intercambios abiertos de una cuenta y devuelve los ejemplares a
 * su estado disponible.
 *
 * Lo usa `deleteAccount`: una baja no puede dejar el libro de otra persona
 * bloqueado en `reserved` para siempre (sin UI que lo libere). No avisa a
 * nadie porque la cuenta está desapareciendo.
 */
export function cancelExchangesForAccount(userId: string): number {
  const db = getDb();
  const now = nowIso();
  const open = db
    .prepare(
      `SELECT id, listing_id FROM requests
        WHERE (owner_id = ? OR requester_id = ?) AND status IN ('pending','accepted')`,
    )
    .all(userId, userId) as { id: string; listing_id: string }[];
  if (open.length === 0) return 0;

  const cancel = db.prepare("UPDATE requests SET status = 'cancelled', updated_at = ? WHERE id = ?");
  const otherAccepted = db.prepare(
    "SELECT 1 FROM requests WHERE listing_id = ? AND status = 'accepted' AND id <> ?",
  );
  const readListing = db.prepare("SELECT status FROM listings WHERE id = ?");
  const release = db.prepare("UPDATE listings SET status = ? WHERE id = ? AND status = 'reserved'");

  db.transaction(() => {
    for (const row of open) {
      cancel.run(now, row.id);
      // Si otra solicitud sigue aceptada, el ejemplar pertenece a ese cierre.
      if (otherAccepted.get(row.listing_id, row.id)) continue;
      const listing = readListing.get(row.listing_id) as { status: ListingStatus } | undefined;
      if (!listing || listing.status !== "reserved") continue;
      release.run(listingStatusFor(listing.status, "cancelled"), row.listing_id);
    }
  })();
  return open.length;
}

function assertParticipant(requestId: string, userId: string) {
  const request = getDb()
    .prepare("SELECT requester_id, owner_id FROM requests WHERE id = ?")
    .get(requestId) as { requester_id: string; owner_id: string } | undefined;
  if (!request || (request.requester_id !== userId && request.owner_id !== userId)) {
    throw new ApiError(404, "La solicitud no existe.");
  }
  return request;
}

export function requestMessageStamp(
  requestId: string,
  userId: string,
): { count: number; lastId: string | null } {
  assertParticipant(requestId, userId);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count,
              (SELECT id FROM messages WHERE request_id = ? ORDER BY rowid DESC LIMIT 1) AS last_id
         FROM messages WHERE request_id = ?`,
    )
    .get(requestId, requestId) as { count: number; last_id: string | null };
  return { count: row.count, lastId: row.last_id };
}

export function listMessages(
  requestId: string,
  userId: string,
  options: { limit?: number; beforeId?: string | null } = {},
): { messages: MessageView[]; hasMore: boolean } {
  assertParticipant(requestId, userId);
  const limit = options.limit ?? 50;
  const beforeId = options.beforeId ?? null;

  // El cursor es el `rowid` (orden de inserción): dos mensajes del mismo
  // milisegundo no se pierden como pasaria comparando fechas.
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.body, m.ciphertext, m.iv, m.key_id, m.encrypted, m.created_at,
              m.sender_device_id,
              u.id AS sender_id, u.name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.request_id = @requestId
         AND (@beforeId IS NULL OR m.rowid < (SELECT rowid FROM messages WHERE id = @beforeId))
       ORDER BY m.rowid DESC
       LIMIT @limit`,
    )
    .all({ requestId, beforeId, limit: limit + 1 }) as {
    id: string;
    body: string;
    ciphertext: string | null;
    iv: string | null;
    key_id: string | null;
    sender_device_id: string | null;
    encrypted: number;
    created_at: string;
    sender_id: string;
    sender_name: string;
  }[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const envelopes = messageEnvelopesFor(
    "message_envelopes",
    page.map((row) => row.id),
  );

  return {
    messages: page.reverse().map((row) => ({
      id: row.id,
      body: row.encrypted ? "" : row.body,
      ciphertext: row.ciphertext,
      iv: row.iv,
      keyId: row.key_id,
      senderDeviceId: row.sender_device_id,
      envelopes: envelopes.get(row.id) ?? [],
      encrypted: Boolean(row.encrypted),
      createdAt: row.created_at,
      sender: { id: row.sender_id, name: row.sender_name },
      isMine: row.sender_id === userId,
    })),
    hasMore,
  };
}

function otherParticipant(
  request: { requester_id: string; owner_id: string },
  userId: string,
): string {
  return request.requester_id === userId ? request.owner_id : request.requester_id;
}

function assertCanMessage(
  requestId: string,
  userId: string,
): { requester_id: string; owner_id: string } {
  assertVerified(userId);
  const request = getDb()
    .prepare("SELECT requester_id, owner_id, status FROM requests WHERE id = ?")
    .get(requestId) as
    | { requester_id: string; owner_id: string; status: RequestStatus }
    | undefined;
  if (!request || (request.requester_id !== userId && request.owner_id !== userId)) {
    throw new ApiError(404, "La solicitud no existe.");
  }
  // La conversación no existe hasta que hay intercambio: mientras la solicitud
  // está pendiente no hay nada que coordinar, y cuando se rechaza o se cancela
  // ya no queda nada que decir. El hilo se conserva para poder releerlo.
  if (request.status !== "accepted") {
    throw new ApiError(
      409,
      request.status === "pending"
        ? "Todavía no podéis escribir: los mensajes se abren cuando se acepta el intercambio."
        : "Este intercambio está cerrado: ya no se pueden enviar mensajes.",
    );
  }
  if (areBlocked(userId, otherParticipant(request, userId))) {
    throw new ApiError(409, "No puedes enviar mensajes a esta persona.");
  }
  return request;
}

function storeMessage(input: {
  requestId: string;
  userId: string;
  otherId: string;
  body: string;
  ciphertext: string | null;
  iv: string | null;
  keyId: string | null;
  senderDeviceId: string | null;
  envelopes: MessageEnvelopeView[];
  v2: V2MessageInput | null;
}): MessageView {
  const db = getDb();
  const id = `msg_${randomUUID()}`;
  const now = nowIso();
  const user = getUserById(input.userId);
  if (!user) throw new ApiError(401, "Necesitas iniciar sesión.");

  db.transaction(() => {
    db.prepare(
      `INSERT INTO messages
         (id, request_id, sender_id, body, ciphertext, iv, key_id, encrypted, created_at, sender_device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.requestId,
      input.userId,
      input.body,
      input.ciphertext,
      input.iv,
      input.keyId,
      input.ciphertext || input.envelopes.length > 0 || input.v2 ? 1 : 0,
      now,
      input.senderDeviceId,
    );
    // Un sobre por cada clave activa del destinatario. El mensaje no guarda el
    // texto: cada aparato abre el suyo con su clave privada.
    const insertEnvelope = db.prepare(
      `INSERT INTO message_envelopes (message_id, key_id, ciphertext, iv, protocol, type)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const envelope of input.envelopes) {
      insertEnvelope.run(id, envelope.keyId, envelope.ciphertext, envelope.iv, 1, null);
    }
    // Y uno por cada dispositivo de v2: el cuerpo es el mensaje de libolm, que
    // el servidor guarda tal cual sin poder abrirlo.
    for (const envelope of input.v2?.envelopes ?? []) {
      insertEnvelope.run(id, envelope.recipientDeviceId, envelope.body, "", 2, envelope.type);
    }
    db.prepare("UPDATE requests SET updated_at = ? WHERE id = ?").run(now, input.requestId);

    // El aviso nunca incluye el contenido: ni la bandeja ni la base de datos
    // deben permitir leer una conversación cifrada.
    notify({
      userId: input.otherId,
      type: "message",
      title: "Nuevo mensaje en tu intercambio",
      body: `${user.name} te ha escrito. Abre la conversación para leerlo.`,
      requestId: input.requestId,
      link: `/intercambios?t=${input.requestId}`,
    });
  })();

  // Aviso inmediato a las conexiones SSE de este proceso.
  publishRequestMessage(input.requestId);

  return {
    id,
    body: input.body,
    ciphertext: input.ciphertext,
    iv: input.iv,
    keyId: input.keyId,
    senderDeviceId: input.senderDeviceId,
    envelopes: input.envelopes,
    encrypted: Boolean(input.ciphertext) || input.envelopes.length > 0 || Boolean(input.v2),
    createdAt: now,
    sender: { id: user.id, name: user.name },
    isMine: true,
  };
}

/**
 * Mensaje en claro. **Solo para pruebas y datos heredados**: el API de
 * `/api/requests/[id]/messages` ya no acepta texto plano (exige sobres), así
 * que este camino no es alcanzable desde HTTP. Se conserva para poder montar
 * conversaciones legibles en las pruebas, y sigue negándose en cuanto alguna de
 * las dos partes tiene clave publicada.
 */
export function addMessage(requestId: string, userId: string, body: string): MessageView {
  const request = assertCanMessage(requestId, userId);
  const otherId = otherParticipant(request, userId);
  // Basta con que una de las dos partes tenga clave publicada para que el
  // servidor deje de aceptar texto plano: así nadie puede degradar el cifrado.
  if (hasPublicKey(userId) || hasPublicKey(otherId)) {
    throw new ApiError(
      409,
      "Esta conversación está cifrada: el mensaje debe enviarse cifrado.",
    );
  }
  return storeMessage({
    requestId,
    userId,
    otherId,
    body,
    ciphertext: null,
    iv: null,
    keyId: null,
    senderDeviceId: null,
    envelopes: [],
    v2: null,
  });
}

/**
 * Mensaje cifrado de extremo a extremo: el servidor solo guarda los sobres.
 *
 * `keyId` es la clave del **remitente** (va en el AAD del cliente). Cada sobre
 * va dirigido a una clave del destinatario; los clientes nuevos mandan uno por
 * cada ranura activa. Los antiguos mandaban un único `ciphertext`/`iv` sin
 * destinatario anotado y se conserva tal cual para que su historial se lea.
 */
export function addEncryptedMessage(
  requestId: string,
  userId: string,
  input: {
    keyId?: string;
    ciphertext?: string;
    iv?: string;
    envelopes?: MessageEnvelopeView[];
    v2?: V2MessageInput;
  },
): MessageView {
  const request = assertCanMessage(requestId, userId);
  const otherId = otherParticipant(request, userId);

  // Un mensaje va con sobres v1 (una ranura por aparato) o con sobres v2 (un
  // dispositivo por sobre), nunca con los dos a la vez.
  if (input.v2) {
    assertV2Envelopes(userId, otherId, input.v2);
  }

  const envelopes = input.envelopes ?? [];
  // Un `keyId` propio significa que el cliente habla v1: entonces se le exigen
  // sus claves y las de la otra parte, aunque el sobre venga luego mal.
  const usesV1 = Boolean(input.keyId) || envelopes.length > 0 || Boolean(input.ciphertext && input.iv);
  if (usesV1) {
    assertV1Envelopes(userId, otherId, input, envelopes);
    if (envelopes.length === 0 && !(input.ciphertext && input.iv)) {
      throw new ApiError(400, "Falta el sobre cifrado.");
    }
  }
  if (!usesV1 && !input.v2) throw new ApiError(400, "Falta el sobre cifrado.");
  assertNoV1WhenV2(userId, otherId, { hasV1: usesV1, hasV2: Boolean(input.v2) });

  return storeMessage({
    requestId,
    userId,
    otherId,
    body: "",
    ciphertext: usesV1 && envelopes.length === 0 ? input.ciphertext ?? null : null,
    iv: usesV1 && envelopes.length === 0 ? input.iv ?? null : null,
    // En v2 el `key_id` del mensaje es el dispositivo que firma: el receptor lo
    // necesita para saber a qué paquete del registro pedir la clave.
    // `keyId` se queda con la ranura de v1: el AAD de v1 se calcula con ella y
    // el dispositivo de v2 va en su propia columna.
    keyId: input.keyId ?? null,
    senderDeviceId: input.v2?.senderDeviceId ?? null,
    envelopes,
    v2: input.v2 ?? null,
  });
}

/**
 * Reglas de los sobres de v1: la clave del remitente tiene que ser suya y hay
 * que cubrir **todas** las ranuras activas del destinatario. Con una de menos,
 * ese aparato se queda sin poder abrir el mensaje y nadie se entera hasta que lo
 * intenta leer.
 */
function assertV1Envelopes(
  userId: string,
  otherId: string,
  input: { keyId?: string; ciphertext?: string; iv?: string },
  envelopes: MessageEnvelopeView[],
): void {
  if (envelopes.length > 0 || Boolean(input.ciphertext && input.iv)) assertV1StillAllowed();
  const senderKeys = listPublicKeyRecords(userId);
  if (senderKeys.length === 0) {
    throw new ApiError(409, "Publica tu clave de cifrado antes de enviar mensajes.");
  }
  if (!input.keyId || !senderKeys.some((key) => key.keyId === input.keyId)) {
    throw new ApiError(409, "Tu clave de cifrado ha cambiado: recarga la conversación.");
  }
  const peerKeys = listPublicKeyRecords(otherId);
  if (peerKeys.length === 0) {
    throw new ApiError(409, "La otra persona todavía no ha activado el cifrado.");
  }
  if (envelopes.length === 0) return;

  const allowed = new Set(peerKeys.map((key) => key.keyId));
  const seen = new Set<string>();
  for (const envelope of envelopes) {
    if (!allowed.has(envelope.keyId)) {
      throw new ApiError(400, "Hay un sobre dirigido a una clave que no es de la otra persona.");
    }
    if (seen.has(envelope.keyId)) {
      throw new ApiError(400, "Hay dos sobres para la misma clave.");
    }
    seen.add(envelope.keyId);
  }
  if (peerKeys.some((key) => !seen.has(key.keyId))) {
    throw new ApiError(409, FALTAN_SOBRES);
  }
}

/**
 * Claves públicas de las dos partes de una conversación. Son datos públicos por
 * diseño: sin la privada (que nunca sale del navegador) no permiten descifrar.
 */
export function conversationKeys(
  requestId: string,
  userId: string,
) {
  const request = assertParticipant(requestId, userId);
  const peerId = otherParticipant(request, userId);
  const me = getUserById(userId);
  const peer = getUserById(peerId);
  if (!me || !peer) throw new ApiError(404, "La solicitud no existe.");
  const myKeys = listPublicKeyRecords(me.id);
  const peerKeys = listPublicKeyRecords(peer.id);
  // La ranura web es la que leen los clientes anteriores como clave única.
  const myWeb = myKeys.find((key) => key.platform === "web") ?? myKeys[0] ?? null;
  const peerWeb = peerKeys.find((key) => key.platform === "web") ?? peerKeys[0] ?? null;
  return {
    me: {
      id: me.id,
      name: me.name,
      publicJwk: myWeb?.jwk ?? null,
      keyId: myWeb?.keyId ?? null,
      keys: toPublicKeyEntries(myKeys),
    },
    peer: {
      id: peer.id,
      name: peer.name,
      publicJwk: peerWeb?.jwk ?? null,
      keyId: peerWeb?.keyId ?? null,
      keys: toPublicKeyEntries(peerKeys),
    },
  };
}

