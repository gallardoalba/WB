import raw from "./post-offices.json";
import { distanceKm, findCity } from "./cities";

/**
 * Puntos de entrega públicos: oficinas y sucursales asociadas de Deutsche Post.
 *
 * Los datos vienen de OpenStreetMap (consulta Overpass sobre
 * `amenity=post_office` en Baden-Württemberg, noviembre de 2026) y se publican
 * bajo ODbL. Se guardan solo direcciones de locales comerciales: la plataforma
 * nunca pide ni almacena la dirección de una persona.
 *
 * `city` es la ciudad de la plataforma a la que la oficina está más cerca;
 * `distanceKm` se recalcula en tiempo de ejecución desde el centro de la ciudad
 * que corresponda, así que este valor es solo una referencia del conjunto.
 */
export type PostOffice = {
  id: string;
  name: string;
  /** `post` = oficina de Deutsche Post; `partner` = comercio asociado. */
  kind: "post" | "partner";
  street: string;
  postalCode: string;
  /** Municipio real donde está la oficina. */
  locality: string;
  city: string;
  distanceKm: number;
  lat: number;
  lon: number;
  osm: string;
};

export const POST_OFFICE_ATTRIBUTION =
  "Direcciones de OpenStreetMap, disponibles bajo licencia ODbL.";

function parseOffice(value: unknown): PostOffice | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : "";
  const name = typeof item.name === "string" ? item.name : "";
  if (!id || !name) return null;
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id,
    name,
    kind: item.kind === "partner" ? "partner" : "post",
    street: typeof item.street === "string" ? item.street : "",
    postalCode: typeof item.postalCode === "string" ? item.postalCode : "",
    locality: typeof item.locality === "string" ? item.locality : "",
    city: typeof item.city === "string" ? item.city : "",
    distanceKm: Number.isFinite(Number(item.distanceKm)) ? Number(item.distanceKm) : 0,
    lat,
    lon,
    osm: typeof item.osm === "string" ? item.osm : "",
  };
}

export const POST_OFFICES: PostOffice[] = Array.isArray(raw)
  ? raw.map(parseOffice).filter((office): office is PostOffice => office !== null)
  : [];

const BY_ID = new Map(POST_OFFICES.map((office) => [office.id, office]));

/** Devuelve la oficina por identificador (o `null` si ya no existe). */
export function findPostOffice(id: string | null | undefined): PostOffice | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

/** Distancia de la oficina al centro de una ciudad de la plataforma. */
export function postOfficeDistance(office: PostOffice, city: string): number | null {
  const center = findCity(city);
  if (!center) return null;
  return distanceKm(center, { name: office.id, lat: office.lat, lng: office.lon });
}

/**
 * Oficinas a menos de 25 km del centro de `city`. Fuera de esa distancia no se
 * propone ninguna: la plataforma ya cubre toda Alemania y no tiene sentido
 * mandar a alguien a otra región. En ese caso el intercambio usa el punto
 * público genérico («a acordar en la ciudad»), que no guarda direcciones.
 */
export function officesForCity(city: string, limit = 3): (PostOffice & { distanceKm: number })[] {
  const scored = POST_OFFICES.map((office) => ({
    ...office,
    distanceKm: postOfficeDistance(office, city) ?? office.distanceKm,
  }))
    .filter((office) => office.distanceKm <= 25)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  return scored.slice(0, Math.max(0, limit));
}

/** Oficina más cercana a la ciudad indicada (la que se propone por defecto). */
export function nearestPostOffice(city: string): (PostOffice & { distanceKm: number }) | null {
  return officesForCity(city, 1)[0] ?? null;
}

/** Texto de una sola línea con la dirección pública de la oficina. */
export function formatPostOffice(office: PostOffice): string {
  const town = [office.postalCode, office.locality].filter(Boolean).join(" ");
  return [office.street, town].filter(Boolean).join(", ") || office.name;
}
