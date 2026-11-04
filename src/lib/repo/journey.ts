import { getDb } from "../db";
import type { ReaderBadge, ReaderJourney } from "../domain";

/**
 * Cifras del recorrido de una cuenta. Se calculan al vuelo: no hace falta
 * guardar contadores que se puedan desincronizar.
 */
export function getReaderJourney(userId: string): ReaderJourney {
  const db = getDb();
  // Una sola consulta con subconsultas escalares: el perfil se visita mucho.
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM listings
           WHERE owner_id = @userId AND status <> 'removed') AS shared,
         (SELECT COUNT(*) FROM requests
           WHERE owner_id = @userId AND status = 'completed') AS given,
         (SELECT COUNT(*) FROM requests
           WHERE requester_id = @userId AND status = 'completed') AS received,
         (SELECT COUNT(*) FROM book_comments c JOIN users u ON u.id = c.author_id
           WHERE c.author_id = @userId AND c.status <> 'hidden' AND u.is_suspended = 0) AS comments,
         (SELECT COUNT(*) FROM reading_lists WHERE owner_id = @userId) AS lists,
         (SELECT COUNT(*) FROM reading_list_items i
           JOIN reading_lists rl ON rl.id = i.list_id
           WHERE rl.owner_id = @userId) AS list_items,
         (SELECT COUNT(*) FROM club_members WHERE user_id = @userId) AS clubs`,
    )
    .get({ userId }) as {
    shared: number;
    given: number;
    received: number;
    comments: number;
    lists: number;
    list_items: number;
    clubs: number;
  };
  const { shared, given, received, comments, lists, clubs } = counts;
  const listItems = counts.list_items;

  // Kilómetros y ciudades: solo de intercambios cerrados (libros que viajaron).
  const swaps = db
    .prepare(
      `SELECT own.city AS owner_city, req.city AS requester_city
       FROM requests r
       JOIN users own ON own.id = r.owner_id
       JOIN users req ON req.id = r.requester_id
       WHERE r.status = 'completed' AND (r.owner_id = ? OR r.requester_id = ?)`,
    )
    .all(userId, userId) as { owner_city: string; requester_city: string }[];

  const kmFor = db.prepare(
    "SELECT km FROM city_distances WHERE from_name = ? AND to_name = ?",
  );
  let km = 0;
  const cities = new Set<string>();
  for (const swap of swaps) {
    cities.add(swap.owner_city);
    cities.add(swap.requester_city);
    const row = kmFor.get(swap.owner_city, swap.requester_city) as { km: number } | undefined;
    if (row) km += row.km;
  }

  return {
    shared,
    given,
    received,
    comments,
    lists,
    clubs,
    cities: cities.size,
    km: Math.round(km * 10) / 10,
    badges: buildBadges({ given, received, shared, comments, clubs, cities: cities.size, lists, listItems }),
  };
}

/** Insignias derivadas de las cifras (sin tabla ni estado que mantener). */
function buildBadges(input: {
  given: number;
  received: number;
  shared: number;
  comments: number;
  clubs: number;
  cities: number;
  lists: number;
  listItems: number;
}): ReaderBadge[] {
  const swaps = input.given + input.received;
  return [
    { id: "first-swap", label: "Primer intercambio", hint: "Cierra tu primer intercambio.", earned: swaps >= 1 },
    { id: "five-swaps", label: "Cinco viajes", hint: "Cinco libros han cambiado de manos.", earned: swaps >= 5 },
    { id: "ten-shared", label: "Estantería generosa", hint: "Publica diez ejemplares.", earned: input.shared >= 10 },
    { id: "talker", label: "Conversador", hint: "Escribe diez comentarios.", earned: input.comments >= 10 },
    { id: "explorer", label: "Tres ciudades", hint: "Intercambia en tres ciudades de la región.", earned: input.cities >= 3 },
    { id: "club", label: "Leer en compañía", hint: "Únete a un club de lectura.", earned: input.clubs >= 1 },
    { id: "curator", label: "Curador", hint: "Crea una lista con tres libros.", earned: input.lists >= 1 && input.listItems >= 3 },
  ];
}

