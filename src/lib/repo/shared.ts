import { getDb } from "../db";
import { findCity } from "../cities";
import { ApiError } from "../errors";
import { normalizeText } from "../text";
import type { ListingStatus, ListingView, RequestStatus } from "../domain";

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
  "book2peer",
  "book 2 peer",
  "wanderbibliothek",
  "wander bibliothek",
  "equipo",
  "soporte",
  "admin",
  "administracion",
  "moderacion",
  "equipo book2peer",
  "book2peer equipo",
  "book2peer soporte",
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
};

export const listingSelect = (distanceExpression = "l.distance_km") => `
  SELECT l.id, b.id AS book_id, b.title, b.author, b.isbn, b.category, b.language, l.condition AS book_condition,
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
    coverUrl: row.cover_url,
    status: row.status,
    createdAt: row.created_at,
    notes: row.notes,
    owner: { id: row.owner_id, name: row.owner_name },
    tags: row.tags ? row.tags.split("|") : [],
    isMine: Boolean(row.is_mine),
    isFavorite: Boolean(row.is_favorite),
    myRequestStatus: row.my_request_status ?? null,
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

