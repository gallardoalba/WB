import { getDb } from "../db";
import { findCity } from "../cities";
import { ApiError } from "../errors";
import { normalizeCoverUrl, normalizeText } from "../text";
import type {
  ListingStatus,
  ListingView,
  MessageEnvelopeView,
  RequestStatus,
} from "../domain";

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Aviso común cuando el cliente no preparó un sobre para cada dispositivo.
 *
 * Un mensaje con un sobre de menos se guarda sin queja y el aparato que se
 * quedó fuera no puede leerlo: el fallo aparecería días después y sin relación
 * aparente con el envío, así que se rechaza en el momento.
 */
export const FALTAN_SOBRES =
  "Faltan sobres: hay un dispositivo de la otra persona que no podría leer el mensaje. Recarga la conversación y vuelve a enviarlo.";

/** Errores de unicidad/restricción de SQLite (carreras entre dos peticiones). */
export function isConstraintError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return String((error as { code?: unknown }).code).startsWith("SQLITE_CONSTRAINT");
}

/**
 * Nombres que se reservan para el equipo: evita que una cuenta se haga pasar
 * por soporte o moderación desde el perfil.
 */
const RESERVED_NAMES = new Set([
  "wanderbibliothek",
  "book 2 peer",
  "wanderbibliothek",
  "wander bibliothek",
  "equipo",
  "soporte",
  "admin",
  "administracion",
  "moderacion",
  "equipo wanderbibliothek",
  "wanderbibliothek equipo",
  "wanderbibliothek soporte",
  "equipo wanderbibliothek",
  "wanderbibliothek equipo",
  "wanderbibliothek soporte",
]);

export function assertPublicName(name: string): void {
  if (RESERVED_NAMES.has(normalizeText(name))) {
    throw new ApiError(422, "Ese nombre está reservado para el equipo de Wanderbibliothek.");
  }
}
export type ListingRow = {
  id: string;
  book_id: string;
  title: string;
  author: string;
  isbn: string | null;
  category: string;
  language: string;
  book_condition: string;
  city: string;
  distance_km: number | null;
  cover_url: string | null;
  status: ListingStatus;
  created_at: string;
  notes: string;
  owner_id: string;
  owner_name: string;
  /** `exact` o `hidden`: lo que eligió la persona para su ciudad. */
  owner_city_precision: string;
  tags: string | null;
  is_mine: number;
  is_favorite: number;
  my_request_status: RequestStatus | null;
  publisher: string | null;
  year: string | null;
  series: string | null;
  /** 1 si la copia llegó por un intercambio de la plataforma. */
  travelled: number;
};

export const listingSelect = (distanceExpression = "l.distance_km") => `
  SELECT l.id, b.id AS book_id, b.title, b.author, b.isbn, b.category, b.language, l.condition AS book_condition,
         b.publisher, b.year, b.series,
         l.city, ${distanceExpression} AS distance_km, l.status, l.created_at,
         l.notes, b.cover_url,
         CASE WHEN l.from_listing_id IS NULL THEN 0 ELSE 1 END AS travelled,
         (SELECT group_concat(lt.tag, '|') FROM listing_tags lt WHERE lt.listing_id = l.id) AS tags,
         u.id AS owner_id, u.name AS owner_name, u.city_precision AS owner_city_precision,
         CASE WHEN l.owner_id = @userId THEN 1 ELSE 0 END AS is_mine,
         CASE WHEN f.user_id IS NULL THEN 0 ELSE 1 END AS is_favorite,
         (SELECT r.status FROM requests r
           WHERE r.listing_id = l.id AND r.requester_id = @userId
             AND r.status IN ('pending','accepted')
           LIMIT 1) AS my_request_status
  FROM listings l
  JOIN books b ON b.id = l.book_id
  JOIN users u ON u.id = l.owner_id
  LEFT JOIN favorites f ON f.listing_id = l.id AND f.user_id = @userId
`;

export const VISIBILITY = `l.status <> 'removed'`;
// Una cuenta suspendida deja de mostrarse en el catálogo público.
export const OWNER_ACTIVE = `NOT EXISTS (
  SELECT 1 FROM users su WHERE su.id = l.owner_id AND su.is_suspended = 1
)`;

/**
 * Todos los libros que son la **misma obra**: el propio y sus otras ediciones.
 *
 * Con la clave de obra, «El infinito en un junco» en tapa dura y en bolsillo
 * (dos ISBN) comparten conversación y ejemplares. Una fila antigua sin clave se
 * queda sola en lugar de mezclarse con nada.
 */
export function workBookIds(bookId: string): string[] {
  const db = getDb();
  // `work_id` es la identidad (v57); `work_key` queda como puente para una fila
  // que aún no la tenga.
  const row = db.prepare("SELECT work_id, work_key FROM books WHERE id = ?").get(bookId) as
    | { work_id: string | null; work_key: string | null }
    | undefined;
  if (!row) return [bookId];
  const rows = row.work_id
    ? (db.prepare("SELECT id FROM books WHERE work_id = ?").all(row.work_id) as { id: string }[])
    : row.work_key
      ? (db.prepare("SELECT id FROM books WHERE work_key = ?").all(row.work_key) as { id: string }[])
      : [];
  return rows.length > 0 ? rows.map((item) => item.id) : [bookId];
}

/** Lista SQL `col IN (…)` con los ids dados, sin interpolar valores. */
export function workIdsClause(
  column: string,
  ids: readonly string[],
): { clause: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const placeholders = ids.map((id, index) => {
    params[`book${index}`] = id;
    return `@book${index}`;
  });
  return { clause: `${column} IN (${placeholders.join(",")})`, params };
}
/** Bloqueo cruzado genérico entre quien mira (`viewerParam`) y otra columna. */
export const blockPair = (viewerParam: string, otherExpr: string) => `
  NOT EXISTS (
    SELECT 1 FROM blocks b1 WHERE b1.blocker_id = ${viewerParam} AND b1.blocked_id = ${otherExpr}
  )
  AND NOT EXISTS (
    SELECT 1 FROM blocks b2 WHERE b2.blocker_id = ${otherExpr} AND b2.blocked_id = ${viewerParam}
  )
`;

export const BLOCK_FILTER = `
  NOT EXISTS (
    SELECT 1 FROM blocks bl
    WHERE bl.blocker_id = @userId AND bl.blocked_id = l.owner_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM blocks bl
    WHERE bl.blocker_id = l.owner_id AND bl.blocked_id = @userId
  )
`;

/** `2026-11-09T…` → `2026-11-01T…`: el mes basta y no señala el día. */
function monthOf(iso: string): string {
  return /^\d{4}-\d{2}/.test(iso) ? `${iso.slice(0, 7)}-01T00:00:00.000Z` : "";
}

/**
 * Vista pública de un ejemplar.
 *
 * `viewerId` decide cuánto se cuenta: sin sesión solo viajan los datos del
 * libro y la ciudad. Ni nombre, ni iniciales, ni id (abre el perfil), ni la nota
 * libre del anuncio —donde la gente escribe nombres y direcciones—, ni la fecha
 * exacta de publicación, que cruzada con el aviso del bot permite atribuir la
 * aportación a alguien. El valor por defecto es el más cerrado, para que un
 * llamador nuevo no exponga de más por olvido.
 */
export function toListingView(row: ListingRow, viewerId?: string | null): ListingView {
  const anonymous = !viewerId;
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    author: row.author,
    isbn: row.isbn,
    category: row.category,
    language: row.language,
    condition: row.book_condition,
    // La ciudad es la del anuncio, pero quien publica puede preferir no
    // enseñarla: entonces solo la ve en sus propios ejemplares.
    city: row.owner_city_precision === "hidden" && !row.is_mine ? "" : row.city,
    distanceKm: row.distance_km,
    // Cualquier URL antigua de Open Library se sirve desde la app: la CSP solo
    // permite imágenes del propio origen.
    coverUrl: normalizeCoverUrl(row.cover_url),
    status: row.status,
    // Al mes: el día exacto empareja la publicación con el aviso público del
    // bot y delata rutinas.
    createdAt: anonymous ? monthOf(row.created_at) : row.created_at,
    notes: anonymous ? "" : row.notes,
    owner: anonymous
      ? { id: "", name: "", masked: true }
      : { id: row.owner_id, name: row.owner_name },
    tags: row.tags ? row.tags.split("|") : [],
    isMine: Boolean(row.is_mine),
    isFavorite: Boolean(row.is_favorite),
    myRequestStatus: row.my_request_status ?? null,
    publisher: row.publisher ?? null,
    year: row.year ?? null,
    series: row.series ?? null,
    travelled: Boolean(row.travelled),
  };
}

/** Ciudad declarada por una cuenta (para calcular distancias). */
export function userCity(userId: string): string | null {
  const row = getDb()
    .prepare("SELECT city FROM users WHERE id = ?")
    .get(userId) as { city: string } | undefined;
  return row?.city ?? null;
}

/**
 * Piezas para mostrar/ordenar por distancia real: ciudad de quien mira →
 * ciudad del ejemplar. Sin ciudad conocida no se inventa ninguna cifra.
 */
export function distanceParts(viewerId: string | null | undefined) {
  const city = viewerId ? findCity(userCity(viewerId)) : null;
  return {
    join: city
      ? "LEFT JOIN city_distances nd ON nd.from_name = @fromCity AND nd.to_name = l.city"
      : "",
    expression: city ? "COALESCE(nd.km, l.distance_km)" : "NULL",
    fromCity: city?.name ?? "",
  };
}

/**
 * Ciudades que hay de verdad en los datos, para los filtros de la comunidad.
 *
 * Antes salían de una lista fija de municipios alemanes; con la ciudad como
 * texto libre es más útil ofrecer solo las que tienen lectores.
 */
export function citiesInUse(limit = 200): string[] {
  const rows = getDb()
    .prepare(
      `SELECT city FROM users WHERE is_suspended = 0 AND city <> ''
        GROUP BY city ORDER BY city LIMIT ?`,
    )
    .all(limit) as { city: string }[];
  return rows.map((row) => row.city);
}

export function ftsQuery(tokens: string[]): string {
  if (tokens.length === 0) return "";
  return tokens.map((token) => `"${token.replace(/"/g, "")}"*`).join(" ");
}

export function areBlocked(a: string, b: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    )
    .get(a, b, b, a);
  return Boolean(row);
}
export function isBlocked(blockerId: string, blockedId: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?")
    .get(blockerId, blockedId);
  return Boolean(row);
}

/**
 * Sobres de una tanda de mensajes, agrupados por mensaje.
 *
 * Una consulta por página (no una por mensaje) y una tabla por tipo de hilo:
 * el nombre de tabla solo puede ser uno de los dos literales de abajo, así que
 * interpolarlo no abre la puerta a inyección.
 */
export function messageEnvelopesFor(
  table: "message_envelopes" | "dm_message_envelopes",
  messageIds: string[],
): Map<string, MessageEnvelopeView[]> {
  const grouped = new Map<string, MessageEnvelopeView[]>();
  if (messageIds.length === 0) return grouped;
  const placeholders = messageIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT message_id, key_id, ciphertext, iv, protocol, type FROM ${table}
        WHERE message_id IN (${placeholders})
        ORDER BY key_id`,
    )
    .all(...messageIds) as {
    message_id: string;
    key_id: string;
    ciphertext: string;
    iv: string;
    protocol: number;
    type: number | null;
  }[];
  for (const row of rows) {
    const list = grouped.get(row.message_id) ?? [];
    list.push({
      keyId: row.key_id,
      ciphertext: row.ciphertext,
      iv: row.iv,
      protocol: row.protocol === 2 ? 2 : 1,
      ...(row.type === null ? {} : { type: row.type }),
    });
    grouped.set(row.message_id, list);
  }
  return grouped;
}


/** Un sobre v2 tal y como lo manda el cliente: un dispositivo y un cuerpo. */
export type DeviceEnvelopeInput = { recipientDeviceId: string; type: number; body: string };

/** Carga v2 de un mensaje: quién lo firma y para qué dispositivos. */
export type V2MessageInput = { senderDeviceId: string; envelopes: DeviceEnvelopeInput[] };

/**
 * Comprueba que quien escribe puede usar ese dispositivo y que los
 * destinatarios son dispositivos activos de la otra parte.
 *
 * Se hace aquí, en el servidor, porque el sobre de v2 no dice a quién va: si se
 * aceptara un `recipientDeviceId` cualquiera, se podría escribir un mensaje
 * destinado a un dispositivo de una tercera cuenta y dejar al destinatario real
 * sin poder abrirlo.
 */
export function assertV2Envelopes(
  senderUserId: string,
  peerUserId: string,
  v2: V2MessageInput,
): void {
  if (v2.envelopes.length === 0) {
    throw new ApiError(400, "Falta el sobre cifrado.");
  }
  const db = getDb();
  const active = db.prepare(
    `SELECT 1 AS hay FROM device_keys
      WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.is_suspended = 0)`,
  );
  if (!active.get(senderUserId, v2.senderDeviceId, senderUserId)) {
    throw new ApiError(409, "Publica este dispositivo antes de enviar mensajes.");
  }
  const seen = new Set<string>();
  for (const envelope of v2.envelopes) {
    if (seen.has(envelope.recipientDeviceId)) {
      throw new ApiError(400, "Hay dos sobres para el mismo dispositivo.");
    }
    seen.add(envelope.recipientDeviceId);
    if (!active.get(peerUserId, envelope.recipientDeviceId, peerUserId)) {
      throw new ApiError(409, "La otra persona tiene un dispositivo que ya no existe.");
    }
  }

  // Todos los aparatos activos de la otra parte, no solo algunos: con un sobre
  // de menos, ese dispositivo se queda sin leer el mensaje y nadie se entera
  // hasta que lo intenta. v1 ya exigía cobertura completa; v2 también.
  const devices = db
    .prepare(
      `SELECT d.device_id FROM device_keys d
         JOIN users u ON u.id = d.user_id
        WHERE d.user_id = ? AND d.revoked_at IS NULL AND u.is_suspended = 0`,
    )
    .all(peerUserId) as { device_id: string }[];
  if (devices.some((device) => !seen.has(device.device_id))) {
    throw new ApiError(409, FALTAN_SOBRES);
  }
}

/**
 * ¿Los dos lados pueden hablar v2?
 *
 * Se usa para la regla anti-degradación: si el remitente tiene un dispositivo
 * activo y el destinatario también, el mensaje **tiene** que llevar sobres v2.
 * Sin esto, el servidor podría aceptar un mensaje solo v1 en un hilo donde los
 * dos podían hacer las cosas bien, y ese mensaje no tendría forward secrecy ni
 * remitente autenticado.
 */
export function bothHaveV2Devices(a: string, b: string): boolean {
  const db = getDb();
  const one = db.prepare(
    `SELECT 1 AS hay FROM device_keys d
      JOIN users u ON u.id = d.user_id
     WHERE d.user_id = ? AND d.revoked_at IS NULL AND u.is_suspended = 0
     LIMIT 1`,
  );
  return Boolean(one.get(a)) && Boolean(one.get(b));
}

/**
 * Rechaza los sobres de v1 cuando los dos lados podían usar v2.
 *
 * El cliente que ya manda los dos formatos no se entera; el que se quedó atrás
 * recibe un error explicable en vez de degradar la conversación en silencio.
 *
 * También se rechaza la mezcla: un mensaje con sobres de v1 **y** de v2 deja en
 * la base una copia cifrada con la clave estática por conversación, que es justo
 * lo que v2 evita. La interfaz no la manda; el servidor no debe aceptarla de un
 * cliente manipulado.
 */
export function assertNoV1WhenV2(
  senderId: string,
  peerId: string,
  envelopes: { hasV1: boolean; hasV2: boolean },
): void {
  if (!envelopes.hasV1) return;
  if (!bothHaveV2Devices(senderId, peerId)) return;
  throw new ApiError(
    409,
    envelopes.hasV2
      ? "Un mensaje no puede llevar a la vez sobres de v1 y de v2 en una conversación que ya usa el cifrado v2."
      : "Esta conversación ya usa el cifrado v2: actualiza el navegador o activa el dispositivo en «Mi cuenta».",
  );
}

/**
 * Fecha a partir de la cual deja de aceptarse el cifrado v1.
 *
 * v1 deriva una clave estática por conversación: sin forward secrecy y con un
 * remitente que el servidor puede reescribir. Mientras conviven los protocolos
 * hay que decidir cuándo se apaga, y esa decisión no puede ser un día cualquiera
 * que alguien recuerde: se pone aquí con `E2E_V1_SUNSET` (ISO 8601) y, a partir
 * de esa fecha, un mensaje con sobres v1 se rechaza con un motivo claro.
 *
 * Sin la variable no se apaga nada: un despliegue que no lo configure sigue
 * funcionando igual, y el mantenimiento avisa de cuántos mensajes v1 siguen
 * apareciendo para saber cuándo es seguro dar el paso.
 */
export function v1Sunset(): Date | null {
  const raw = process.env.E2E_V1_SUNSET?.trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ¿Se ha pasado ya la fecha de apagado de v1? */
export function v1Retired(now = new Date()): boolean {
  const sunset = v1Sunset();
  return sunset !== null && now >= sunset;
}

/** Rechaza los sobres de v1 cuando el protocolo ya se apagó. */
export function assertV1StillAllowed(): void {
  if (!v1Retired()) return;
  throw new ApiError(
    410,
    "El cifrado antiguo ya no se acepta. Actualiza la página y activa el cifrado v2 en «Mi cuenta» para seguir escribiendo.",
  );
}
