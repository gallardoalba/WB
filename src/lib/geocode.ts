/**
 * Comprobación de la ciudad contra OpenStreetMap.
 *
 * La plataforma cubre toda Europa, así que no hay una lista fija de ciudades:
 * lo que escribe una persona se contrasta con `Nominatim` (OpenStreetMap) y se
 * guarda el nombre con el que lo conoce el mapa. Así «Munich», «munchen» y
 * «München» acaban siendo la misma ciudad, y no hay que mantener a mano un
 * catálogo de municipios de cuarenta países.
 *
 * La distancia es un dato secundario: **no** se guardan coordenadas ni se
 * calculan kilómetros. Lo que se guarda es el nombre.
 *
 * Si Nominatim no responde, el alta no se bloquea: se acepta lo escrito (mejor
 * una ciudad sin comprobar que un registro imposible) y queda en el registro.
 */
import { findCity } from "./cities";
import { normalizeText } from "./text";

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
/** Nominatim exige identificarse y no acepta peticiones en ráfaga. */
const USER_AGENT = "Wanderbibliothek/1.0 (+https://github.com/gallardoalba/wanderbibliothek)";
const TIMEOUT_MS = 4_000;
const MIN_INTERVAL_MS = 1_100;

/**
 * Países que cuentan como Europa para el catálogo (ISO-3166 alfa-2): Unión
 * Europea, Espacio Económico Europeo, Reino Unido, Balcanes, Moldavia, Ucrania,
 * Bielorrusia, Rusia, Turquía y los microestados.
 */
const EUROPE = [
  "ad", "al", "at", "ba", "be", "bg", "by", "ch", "cy", "cz", "de", "dk", "ee",
  "es", "fi", "fo", "fr", "gb", "gg", "gi", "gr", "hr", "hu", "ie", "im", "is",
  "it", "je", "li", "lt", "lu", "lv", "mc", "md", "me", "mk", "mt", "nl", "no",
  "pl", "pt", "ro", "rs", "ru", "se", "si", "sk", "sm", "tr", "ua", "va", "xk",
].join(",");

export type CityLookup =
  /** La ciudad existe: se guarda `name` tal y como lo escribe el mapa. */
  | { status: "found"; name: string }
  /** El geocodificador respondió y no hay ninguna ciudad con ese nombre. */
  | { status: "unknown" }
  /** No se pudo preguntar (red, cuota, mantenimiento): no es culpa de nadie. */
  | { status: "unavailable" };

/** Resultados ya vistos, para no preguntar dos veces por la misma ciudad. */
const CACHE = new Map<string, string>();
const CACHE_LIMIT = 500;

/**
 * Nombre de la ciudad en la respuesta de Nominatim, o `null` si lo que hay no
 * es un núcleo de población (una calle, una región, un país…).
 */
export function cityFromNominatim(payload: unknown): string | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const first = payload[0] as
    | { name?: unknown; address?: Record<string, unknown> }
    | undefined;
  if (!first || typeof first !== "object") return null;
  const address = first.address ?? {};
  for (const field of ["city", "town", "village", "municipality", "hamlet"]) {
    const value = address[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  // Un resultado sin `address` sigue valiendo si trae nombre propio.
  const name = first.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

let lastCall = 0;
let queue: Promise<void> = Promise.resolve();

/** Serializa las llamadas: Nominatim pide como mucho una por segundo. */
function throttle(): Promise<void> {
  queue = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
  });
  return queue;
}

/**
 * Comprueba la ciudad y devuelve su nombre canónico.
 *
 * Primero mira el catálogo de siempre (las ciudades que ya existen en la base
 * no necesitan red) y después pregunta a OpenStreetMap.
 */
export async function resolveCity(raw: string): Promise<CityLookup> {
  const query = raw.trim();
  if (!query) return { status: "unknown" };

  const known = findCity(query);
  if (known) return { status: "found", name: known.name };

  const key = normalizeText(query);
  const cached = CACHE.get(key);
  if (cached) return { status: "found", name: cached };

  let payload: unknown;
  try {
    await throttle();
    const url = new URL(ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", EUROPE);
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { status: "unavailable" };
    payload = await response.json();
  } catch {
    return { status: "unavailable" };
  }

  const name = cityFromNominatim(payload);
  if (!name) return { status: "unknown" };
  if (CACHE.size >= CACHE_LIMIT) CACHE.clear();
  CACHE.set(key, name);
  return { status: "found", name };
}
