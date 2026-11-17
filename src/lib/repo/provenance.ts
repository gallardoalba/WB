import { getDb } from "../db";
import type { CopyJourney, CopyJourneyStop } from "../domain";

/**
 * Recorrido de una copia concreta.
 *
 * Al cerrar un intercambio, quien recibe el libro estrena una lista nueva con
 * `from_listing_id` apuntando a la que se entregó (v44). Eso deja una cadena
 * que se puede recorrer hacia atrás y contar sin guardar contadores: la primera
 * parada es donde se publicó y la última, donde está hoy.
 *
 * Lo que se enseña es siempre **agregado**: ciudades y meses, nunca nombres ni
 * identificadores. Una parada cuyo dueño prefiere no enseñar su ciudad (v48)
 * sale sin ciudad; y quien tiene el libro puede apagar el recorrido entero
 * (v56), en cuyo caso no se devuelve nada a nadie que no sea esa persona.
 */
export function getCopyJourney(
  listingId: string,
  viewerId?: string | null,
): CopyJourney | null {
  const db = getDb();
  // `depth` corta una cadena corrupta (o un ciclo) en vez de colgar la ficha.
  const rows = db
    .prepare(
      `WITH RECURSIVE chain(id, city, owner_id, created_at, from_listing_id, depth) AS (
         SELECT l.id, l.city, l.owner_id, l.created_at, l.from_listing_id, 0
           FROM listings l WHERE l.id = ?
         UNION ALL
         SELECT l.id, l.city, l.owner_id, l.created_at, l.from_listing_id, chain.depth + 1
           FROM listings l JOIN chain ON l.id = chain.from_listing_id
          WHERE chain.depth < 40
       )
       SELECT c.id, c.city, c.owner_id, c.created_at, c.depth,
              u.city_precision, u.show_journey
         FROM chain c JOIN users u ON u.id = c.owner_id
        ORDER BY c.depth DESC`,
    )
    .all(listingId) as {
    id: string;
    city: string;
    owner_id: string;
    created_at: string;
    depth: number;
    city_precision: string;
    show_journey: number;
  }[];

  // Una copia que no ha cambiado de manos no tiene recorrido que contar.
  if (rows.length < 2) return null;

  const current = rows[rows.length - 1];
  const hidden = current.show_journey === 0;
  if (hidden && current.owner_id !== (viewerId ?? "")) return null;

  const stops: CopyJourneyStop[] = rows.map((row) => ({
    city: row.city_precision === "hidden" ? "" : row.city,
    // Al mes: el día exacto se cruza con otros datos y no aporta al relato.
    since: row.created_at.slice(0, 7),
  }));

  const owners = new Set(rows.map((row) => row.owner_id));

  return {
    stops,
    readers: owners.size,
    km: travelledKm(stops.map((stop) => stop.city)),
    hidden,
  };
}

/** Kilómetros entre paradas con ciudad conocida; las ocultas no suman. */
function travelledKm(cities: string[]): number {
  const db = getDb();
  const distance = db.prepare(
    "SELECT km FROM city_distances WHERE from_name = ? AND to_name = ?",
  );
  let km = 0;
  for (let index = 1; index < cities.length; index += 1) {
    const from = cities[index - 1];
    const to = cities[index];
    if (!from || !to || from === to) continue;
    const row = distance.get(from, to) as { km: number } | undefined;
    if (row) km += row.km;
  }
  return Math.round(km * 10) / 10;
}
