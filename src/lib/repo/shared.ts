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
  tags: string | null;
  is_mine: number;
  is_favorite: number;
  my_request_status: RequestStatus | null;
  publisher: string | null;
  year: string | null;
  series: string | null;
};

export const listingSelect = (distanceExpression = "l.distance_km") => `
  SELECT l.id, b.id AS book_id, b.title, b.author, b.isbn, b.category, b.language, l.condition AS book_condition,
         b.publisher, b.year, b.series,
         l.city, ${distanceExpression} AS distance_km, l.status, l.created_at,
         l.notes, b.cover_url,
         (SELECT group_concat(lt.tag, '|') FROM listing_tags lt WHERE lt.listing_id = l.id) AS tags,
         u.id AS owner_id, u.name AS owner_name,
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
  const row = db.prepare("SELECT work_key FROM books WHERE id = ?").get(bookId) as
    | { work_key: string | null }
    | undefined;
  if (!row?.work_key) return [bookId];
  const rows = db.prepare("SELECT id FROM books WHERE work_key = ?").all(row.work_key) as {
    id: string;
  }[];
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

export function toListingView(row: ListingRow): ListingView {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    author: row.author,
    isbn: row.isbn,
    category: row.category,
    language: row.language,
    condition: row.book_condition,
    city: row.city,
    distanceKm: row.distance_km,
    // Cualquier URL antigua de Open Library se sirve desde la app: la CSP solo
    // permite imágenes del propio origen.
    coverUrl: normalizeCoverUrl(row.cover_url, row.isbn),
    status: row.status,
    createdAt: row.created_at,
    notes: row.notes,
    owner: { id: row.owner_id, name: row.owner_name },
    tags: row.tags ? row.tags.split("|") : [],
    isMine: Boolean(row.is_mine),
    isFavorite: Boolean(row.is_favorite),
    myRequestStatus: row.my_request_status ?? null,
    publisher: row.publisher ?? null,
    year: row.year ?? null,
    series: row.series ?? null,
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
 * Antes salían de una lista fija de municipios alemanes; con la plataforma
 * abierta a Europa es más útil ofrecer solo las que tienen lectores o clubes.
 */
export function citiesInUse(kind: "readers" | "clubs", limit = 200): string[] {
  const sql =
    kind === "clubs"
      ? `SELECT city FROM clubs WHERE city <> '' GROUP BY city ORDER BY city LIMIT ?`
      : `SELECT city FROM users WHERE is_suspended = 0 AND city <> ''
           GROUP BY city ORDER BY city LIMIT ?`;
  const rows = getDb().prepare(sql).all(limit) as { city: string }[];
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
      `SELECT message_id, key_id, ciphertext, iv FROM ${table}
        WHERE message_id IN (${placeholders})
        ORDER BY key_id`,
    )
    .all(...messageIds) as {
    message_id: string;
    key_id: string;
    ciphertext: string;
    iv: string;
  }[];
  for (const row of rows) {
    const list = grouped.get(row.message_id) ?? [];
    list.push({ keyId: row.key_id, ciphertext: row.ciphertext, iv: row.iv });
    grouped.set(row.message_id, list);
  }
  return grouped;
}

