import { getDb } from "../db";

/**
 * Catálogo público: lo único del catálogo que puede indexar un buscador.
 *
 * Publica la obra y cifras agregadas, nunca datos de personas. El nombre, el id
 * y el perfil de quien ofrece una copia no salen de aquí: publicar «quién tiene
 * qué libro y en qué ciudad» en Google fue el motivo por el que `robots.txt`
 * bloquea `/libro/`, `/u/` y el resto de vistas con sesión.
 *
 * Las ediciones de una misma obra (mismo `work_key`) comparten página: la URL
 * canónica es la edición más antigua, igual que en `workBooks()`.
 */
export type PublicWorkCity = { city: string; copies: number };

export type PublicWork = {
  /** Edición canónica: la más antigua de la obra. Es la que va en la URL. */
  id: string;
  title: string;
  author: string;
  category: string;
  language: string;
  isbn: string | null;
  coverUrl: string | null;
  /** Verlag, Erscheinungsjahr y Reihe de la edición canónica. */
  publisher: string | null;
  year: string | null;
  series: string | null;
  /** Ejemplares disponibles sumando todas las ediciones de la obra. */
  copies: number;
  /** Ciudades con ejemplares, de más a menos. Nunca quién los tiene. */
  cities: PublicWorkCity[];
};

type BookRow = {
  id: string;
  title: string;
  author: string;
  category: string;
  language: string;
  isbn: string | null;
  cover_url: string | null;
  work_key: string | null;
  publisher: string | null;
  year: string | null;
  series: string | null;
};

type AvailableRow = { book_id: string; city: string };

/** Una cuenta suspendida deja de ofrecer sus ejemplares. */
const OWNER_OK = `NOT EXISTS (
  SELECT 1 FROM users u WHERE u.id = l.owner_id AND u.is_suspended = 1
)`;

/** Todas las ediciones de una obra comparten página. */
function workKeyOf(book: { id: string; work_key: string | null }): string {
  return book.work_key || book.id;
}

function readBooks(): BookRow[] {
  // Orden por antigüedad: la primera fila de cada obra es la canónica.
  return getDb()
    .prepare(
      `SELECT id, title, author, category, language, isbn, cover_url, work_key,
              publisher, year, series
         FROM books
        ORDER BY created_at ASC, id ASC`,
    )
    .all() as BookRow[];
}

function readAvailable(): AvailableRow[] {
  return getDb()
    .prepare(
      `SELECT l.book_id AS book_id, l.city AS city
         FROM listings l
        WHERE l.status = 'available' AND ${OWNER_OK}`,
    )
    .all() as AvailableRow[];
}

function sortedCities(cities: Map<string, number>): PublicWorkCity[] {
  return [...cities.entries()]
    .map(([city, copies]) => ({ city, copies }))
    .sort((a, b) => b.copies - a.copies || a.city.localeCompare(b.city, "de"));
}

function toPublicWork(book: BookRow, cities: Map<string, number>): PublicWork {
  let copies = 0;
  for (const count of cities.values()) copies += count;
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    category: book.category,
    language: book.language,
    isbn: book.isbn,
    coverUrl: book.cover_url,
    publisher: book.publisher ?? null,
    year: book.year ?? null,
    series: book.series ?? null,
    copies,
    cities: sortedCities(cities),
  };
}

/**
 * Índice completo en memoria. El catálogo es pequeño (una fila por ejemplar) y
 * así se agrupan ediciones, se suman ciudades y se ordena de una sola pasada,
 * sin una consulta por obra.
 */
function catalogIndex(): { works: PublicWork[]; byBook: Map<string, PublicWork> } {
  const groups = new Map<string, BookRow[]>();
  for (const book of readBooks()) {
    const key = workKeyOf(book);
    const group = groups.get(key);
    if (group) group.push(book);
    else groups.set(key, [book]);
  }

  const copiesByBook = new Map<string, Map<string, number>>();
  for (const row of readAvailable()) {
    const cities = copiesByBook.get(row.book_id) ?? new Map<string, number>();
    cities.set(row.city, (cities.get(row.city) ?? 0) + 1);
    copiesByBook.set(row.book_id, cities);
  }

  const works: PublicWork[] = [];
  const byBook = new Map<string, PublicWork>();
  for (const editions of groups.values()) {
    const cities = new Map<string, number>();
    for (const edition of editions) {
      for (const [city, count] of copiesByBook.get(edition.id) ?? []) {
        cities.set(city, (cities.get(city) ?? 0) + count);
      }
    }
    // Sin ejemplares disponibles no hay nada que ofrecer: fuera del índice
    // público (y por tanto del sitemap).
    if (cities.size === 0) continue;
    const work = toPublicWork(editions[0]!, cities);
    works.push(work);
    for (const edition of editions) byBook.set(edition.id, work);
  }

  works.sort((a, b) => b.copies - a.copies || a.title.localeCompare(b.title, "de"));
  return { works, byBook };
}

/** Obras con al menos un ejemplar disponible, de más ofertadas a menos. */
export function listPublicWorks(options: { limit?: number; offset?: number } = {}): PublicWork[] {
  const { works } = catalogIndex();
  const offset = Math.max(0, options.offset ?? 0);
  const limit = options.limit === undefined ? works.length : Math.max(0, options.limit);
  return works.slice(offset, offset + limit);
}

/** Cuántas obras se pueden enseñar en público (para paginar y para el sitemap). */
export function publicWorkCount(): number {
  return catalogIndex().works.length;
}

/**
 * Obra por cualquiera de sus ediciones. Devuelve `null` si el libro no existe;
 * si existe pero no tiene ejemplares, devuelve la obra con `copies: 0` para que
 * la página pueda responder con su propio aviso (y `noindex`).
 */
export function getPublicWork(bookId: string): PublicWork | null {
  const indexed = catalogIndex().byBook.get(bookId);
  if (indexed) return indexed;

  const book = getDb()
    .prepare(
      `SELECT id, title, author, category, language, isbn, cover_url, work_key,
              publisher, year, series
         FROM books WHERE id = ?`,
    )
    .get(bookId) as BookRow | undefined;
  if (!book) return null;
  return toPublicWork(book, new Map());
}
