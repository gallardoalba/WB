/**
 * Sugerencias de ciudad para el selector.
 *
 * La ciudad no se escribe a mano: se elige de una lista de municipios
 * alemanes. La lista sale de OpenStreetMap por medio de **Photon**, el buscador
 * que mantiene Komoot sobre los datos del mapa y que sí está pensado para
 * proponer mientras se teclea (Nominatim, que es quien confirma el nombre al
 * guardar, no admite consultas por cada tecla).
 *
 * Esto solo propone: quien decide si la ciudad vale sigue siendo
 * `resolveCity()` al guardar, con Nominatim. Si Photon no responde se devuelve
 * lo que haya en el catálogo local (los municipios de `cities.ts`), así el
 * campo nunca se queda sin nada que ofrecer.
 */
import { CITIES } from "./cities";
import { normalizeText } from "./text";

export type CitySuggestion = {
  name: string;
  /** Estado federado, solo para distinguir municipios homónimos. */
  region: string | null;
};

const PHOTON = "https://photon.komoot.io/api/";
/** Photon pide identificarse, igual que Nominatim. */
const USER_AGENT = "Wanderbibliothek/1.0 (+https://github.com/gallardoalba/wanderbibliothek)";
const TIMEOUT_MS = 2_000;
/** Una consulta cada medio segundo: la caché se encarga del resto. */
const MIN_INTERVAL_MS = 500;
/** Con una letra encaja casi todo el país: no se pregunta. */
export const MIN_QUERY_CHARS = 2;
/** Sugerencias que recibe el selector. */
export const MAX_SUGGESTIONS = 8;
/** Se piden a Photon unos cuantos de más: entre medias se descartan países y calles. */
const REMOTE_LIMIT = 20;
/** Caja envolvente de Alemania (Photon no filtra por país, sí por `bbox`). */
const GERMANY_BBOX = "5.87,47.27,15.04,55.06";
const COUNTRY = "DE";
/** Núcleos de población: ni una calle ni una región sirven como ciudad. */
const PLACES = new Set(["city", "town", "village", "municipality"]);
const CACHE_LIMIT = 500;

type Feature = {
  properties?: Record<string, unknown>;
};

/**
 * Ciudades de una respuesta de Photon.
 *
 * Se mira `properties` y no el nombre del resultado: Photon puede devolver una
 * parada de autobús o una región que también se llamen como la ciudad buscada.
 * Los homónimos (`Neustadt` en varios estados) se quedan una sola vez: la
 * ciudad se guarda por su nombre, así que repetirla no aporta.
 */
export function citiesFromPhoton(payload: unknown, limit = MAX_SUGGESTIONS): CitySuggestion[] {
  const features = (payload as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];

  const found: CitySuggestion[] = [];
  const seen = new Set<string>();
  for (const feature of features as Feature[]) {
    const properties = feature?.properties;
    if (!properties || typeof properties !== "object") continue;
    const country = properties.countrycode;
    if (typeof country === "string" && country.toUpperCase() !== COUNTRY) continue;
    const kind = properties.osm_key;
    if (typeof kind === "string" && kind !== "place") continue;
    const place = properties.osm_value ?? properties.type;
    if (typeof place !== "string" || !PLACES.has(place)) continue;

    const name = typeof properties.name === "string" ? properties.name.trim() : "";
    if (name.length < MIN_QUERY_CHARS) continue;
    const key = normalizeText(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const region = typeof properties.state === "string" ? properties.state.trim() : "";
    found.push({ name, region: region || null });
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * Municipios del catálogo local que encajan con lo escrito, primero los que
 * empiezan por ahí. Funciona sin red y tapa el hueco mientras llega Photon.
 */
export function localCityMatches(query: string, limit = MAX_SUGGESTIONS): CitySuggestion[] {
  const wanted = normalizeText(query);
  if (wanted.length < MIN_QUERY_CHARS) return [];

  const prefix: CitySuggestion[] = [];
  const inside: CitySuggestion[] = [];
  for (const city of CITIES) {
    const key = normalizeText(city.name);
    if (key.startsWith(wanted)) prefix.push({ name: city.name, region: null });
    else if (key.includes(wanted)) inside.push({ name: city.name, region: null });
  }
  return [...prefix, ...inside].slice(0, limit);
}

/** Resultados ya vistos: la misma búsqueda no vuelve a salir a la red. */
const CACHE = new Map<string, CitySuggestion[]>();
/** Consultas en curso: dos pestañas con el mismo texto comparten la petición. */
const IN_FLIGHT = new Map<string, Promise<CitySuggestion[]>>();

let lastCall = 0;
let queue: Promise<void> = Promise.resolve();
/**
 * Cola acotada: con mucha gente escribiendo a la vez, quien llega tarde se
 * queda con el catálogo local en vez de esperar turno durante medio minuto.
 */
let waiting = 0;
const MAX_WAITING = 6;

/** Serializa las llamadas: Photon no quiere ráfagas. */
function throttle(): Promise<void> {
  queue = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
  });
  return queue;
}

/** Hueco en la cola; `false` si ya hay demasiadas consultas esperando. */
async function takeSlot(): Promise<boolean> {
  if (waiting >= MAX_WAITING) return false;
  waiting += 1;
  try {
    await throttle();
    return true;
  } finally {
    waiting -= 1;
  }
}

async function remoteCities(key: string, query: string): Promise<CitySuggestion[]> {
  const cached = CACHE.get(key);
  if (cached) return cached;
  const pending = IN_FLIGHT.get(key);
  if (pending) return pending;

  const run = (async () => {
    try {
      if (!(await takeSlot())) return [];
      const url = new URL(PHOTON);
      url.searchParams.set("q", query);
      url.searchParams.set("lang", "de");
      url.searchParams.set("limit", String(REMOTE_LIMIT));
      url.searchParams.set("bbox", GERMANY_BBOX);
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return [];
      const cities = citiesFromPhoton(await response.json(), MAX_SUGGESTIONS);
      if (CACHE.size >= CACHE_LIMIT) CACHE.clear();
      CACHE.set(key, cities);
      return cities;
    } catch {
      // Red, cuota o tiempo agotado: no se guarda en caché para reintentarlo.
      return [];
    } finally {
      IN_FLIGHT.delete(key);
    }
  })();

  IN_FLIGHT.set(key, run);
  return run;
}

/** Junta las dos fuentes sin repetir el mismo municipio, primero los que empiezan por lo escrito. */
function merge(parts: CitySuggestion[][], query: string, limit: number): CitySuggestion[] {
  const wanted = normalizeText(query);
  const out: CitySuggestion[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const item of part) {
      const key = normalizeText(item.name);
      if (!key || seen.has(key) || out.length >= limit) continue;
      seen.add(key);
      out.push(item);
    }
  }
  // Photon ordena por relevancia y población y cuela coincidencias por el
  // medio del nombre («mün» devolvía «Dortmund»); lo que empieza por lo
  // escrito va delante. El orden dentro de cada grupo no se toca.
  const rank = (item: CitySuggestion) => {
    const key = normalizeText(item.name);
    if (key.startsWith(wanted)) return 0;
    return key.includes(wanted) ? 1 : 2;
  };
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * Sugerencias para lo que se está escribiendo: primero los municipios
 * conocidos (instantáneos) y después los de OpenStreetMap.
 */
export async function searchCities(raw: string, limit = MAX_SUGGESTIONS): Promise<CitySuggestion[]> {
  const query = raw.trim().slice(0, 60);
  const key = normalizeText(query);
  if (key.length < MIN_QUERY_CHARS) return [];

  const local = localCityMatches(query, limit);
  const remote = await remoteCities(key, query);
  return merge([local, remote], query, limit);
}
