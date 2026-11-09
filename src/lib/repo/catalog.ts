import { randomUUID } from "node:crypto";
import { getDb, type Db } from "../db";
import { ApiError } from "../errors";
import type { ListingStatus, ListingView, PagedListings, SortMode } from "../domain";
import { normalizeCoverUrl, normalizeText } from "../text";
import { cachedIsbnMetadata } from "../isbn-metadata";
import { workKeyFromOpenLibrary, workKeyFromTitle } from "../work";
import type { CatalogParams, ListingInput } from "../validation";

/**
 * Lo que necesita el repositorio para crear un ejemplar.
 *
 * La API y el formulario ya exigen idioma y ciudad (`listingSchema`), pero aquí
 * se aceptan sin ellos porque hay dos valores de reserva: el idioma queda como
 * «No especificado» y la ciudad cae en la del propietario. Así las llamadas
 * internas (semilla, pruebas, altas antiguas) siguen funcionando sin inventar
 * datos, mientras que el camino público no puede dejar la ficha a medias.
 */
type ListingInputOpcional = Omit<ListingInput, "language" | "city"> & {
  language?: ListingInput["language"];
  city?: ListingInput["city"];
};
import { getUserById, assertVerified } from "./users";
import { notifyAvailability } from "./alerts";
import { notifyBookWants } from "./wants";
import {
  BLOCK_FILTER,
  blockPair,
  distanceParts,
  ftsQuery,
  isConstraintError,
  listingSelect,
  nowIso,
  OWNER_ACTIVE,
  toListingView,
  VISIBILITY,
  workBookIds,
  workIdsClause,
  type ListingRow,
} from "./shared";

// Quince por página: tres filas completas de cinco columnas en pantallas
// anchas. Al hacer scroll se añade una fila más cada vez (lo pide el cliente
// con `pageSize`), así que la página inicial no obliga a media docena de
// tiradas de red.
export const PAGE_SIZE = 15;

const ORDER_BY: Record<SortMode, string> = {
  // `distance_km` es la distancia calculada desde la ciudad de quien mira.
  near: "distance_km IS NULL, distance_km ASC, l.created_at DESC",
  recent: "l.created_at DESC",
  title: "b.title COLLATE NOCASE ASC",
};

/**
 * Orden «al azar» de la portada.
 *
 * La portada no enseña los últimos ejemplares sino una muestra del catálogo.
 * `ORDER BY RANDOM()` cambiaría la selección en cada visita —y al volver atrás—,
 * que se lee como un fallo; aquí el orden sale de mezclar el `rowid` con un
 * sello que cambia cada hora: la muestra se mantiene mientras dura la hora y se
 * renueva sola. La mezcla es un generador congruencial lineal (`× 1103515245
 * mód 2³¹−1`), que aplicado a rowids seguidos da una permutación sin orden
 * visible. Con decenas de miles de ejemplares habría que muestrear antes en vez
 * de ordenar el catálogo entero.
 */
export function shuffleOrder(now = Date.now()): string {
  const horas = Math.floor(now / 3_600_000);
  // La semilla se mantiene por encima de mil millones a propósito: multiplicar
  // el rowid por un número pequeño (que es lo que sale la mitad de las horas)
  // deja la lista ordenada, y entonces el «azar» no se nota. Por encima de mil
  // millones cada fila da más de una vuelta al módulo y el orden se rompe.
  const semilla = 1_000_000_007 + ((1_103_515_245 * horas) % 1_000_000_007);
  return `(l.rowid * ${semilla}) % 2147483647`;
}

/** Lo que necesita el catálogo; `shuffle` solo lo pone la portada. */
export type CatalogPageParams = CatalogParams & { shuffle?: boolean };

export function catalogPage(userId: string | null, params: CatalogPageParams): PagedListings {
  const db = getDb();
  const viewer = userId ?? "";
  const requestedPage = Math.max(1, params.page);
  const tokens = normalizeText(params.q).split(" ").filter(Boolean);

  // Distancia real: ciudad de quien mira → ciudad del ejemplar (matriz
  // precalculada en `city_distances`).
  const distance = distanceParts(viewer);
  // Sin sesión no hay ciudad desde la que medir, y con una ciudad fuera del
  // catálogo tampoco: en ese caso el radio se ignora en vez de devolver una
  // lista vacía (la distancia es un dato secundario, no un filtro obligatorio).
  const radius = userId && distance.expression !== "NULL" ? params.radius : 0;

  const clauses = [
    VISIBILITY,
    OWNER_ACTIVE,
    BLOCK_FILTER,
    "l.status = 'available'",
    params.category && params.category !== "Todos" ? "b.category = @category" : null,
    params.language && params.language !== "Todos" ? "b.language = @language" : null,
    // Radio real desde la ciudad de quien mira; sin ciudad no se inventa distancia.
    radius > 0
      ? `(${distance.expression}) IS NOT NULL AND (${distance.expression}) <= @radius`
      : null,
    // `listings_fts` respeta acentos y prefijos y usa su propio índice.
    tokens.length > 0 ? "l.rowid IN (SELECT rowid FROM listings_fts WHERE listings_fts MATCH @match)" : null,
    params.tag
      ? "EXISTS (SELECT 1 FROM listing_tags lt WHERE lt.listing_id = l.id AND lt.tag = @tag)"
      : null,
  ].filter(Boolean) as string[];

  const where = `WHERE ${clauses.join(" AND ")}`;
  const binds: Record<string, unknown> = {
    userId: viewer,
    category: params.category,
    language: params.language,
    radius,
    match: ftsQuery(tokens),
    tag: params.tag,
    fromCity: distance.fromCity,
  };

  const { total } = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM listings l JOIN books b ON b.id = l.book_id
       JOIN users u ON u.id = l.owner_id
       ${distance.join}
       ${where}`,
    )
    .get(binds) as { total: number };

  // Tamaño de página: el de la primera pintura o el que pida el scroll
  // (una fila de la rejilla). Se acota para que nadie pida el catálogo entero.
  const pageSize = Math.min(Math.max(params.pageSize ?? PAGE_SIZE, 1), 48);
  // Un `?page=99` (enlace viejo, filtro que reduce los resultados) no debe
  // enseñar una página vacía con «Página 99 de 2»: se cae a la última real.
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const page = params.offset === undefined ? Math.min(requestedPage, lastPage) : requestedPage;
  // El scroll infinito trae una fila más detrás de lo ya pintado: cuenta por
  // desplazamiento, porque el tamaño de cada tirada depende del ancho de la
  // rejilla. Las páginas numeradas siguen calculándolo desde `page`.
  const offset = params.offset ?? (page - 1) * pageSize;

  const rows = db
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join} ${where}
       ORDER BY ${params.shuffle ? shuffleOrder() : ORDER_BY[params.sort]} LIMIT @limit OFFSET @offset`,
    )
    .all({ ...binds, limit: pageSize, offset }) as ListingRow[];

  return {
    items: rows.map((row) => toListingView(row, userId)),
    total,
    page,
    pageSize,
    // Con desplazamiento manda lo que se ha traído de verdad: al final de la
    // lista la última tirada puede ser más corta que `pageSize`.
    hasMore: offset + rows.length < total,
  };
}

export function similarListings(bookId: string, viewerId: string | null, limit = 4): ListingView[] {
  const db = getDb();
  const distance = distanceParts(viewerId ?? "");
  const rows = db
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join}
       WHERE ${VISIBILITY} AND ${OWNER_ACTIVE} AND ${BLOCK_FILTER}
         AND l.status = 'available' AND l.book_id <> @bookId
         AND (
           b.category = (SELECT category FROM books WHERE id = @bookId)
           OR EXISTS (
             SELECT 1
               FROM listing_tags lt
               JOIN listings source ON source.id = lt.listing_id
               JOIN listing_tags candidate ON candidate.tag = lt.tag
              WHERE source.book_id = @bookId AND candidate.listing_id = l.id
           )
         )
       ORDER BY
         CASE WHEN b.category = (SELECT category FROM books WHERE id = @bookId) THEN 0 ELSE 1 END,
         l.created_at DESC
       LIMIT @limit`,
    )
    .all({
      userId: viewerId ?? "",
      bookId,
      fromCity: distance.fromCity,
      limit: Math.min(Math.max(limit, 1), 8),
    }) as ListingRow[];
  return rows.map((row) => toListingView(row, viewerId));
}

/** Convierte los tokens ya normalizados en una consulta FTS5 segura (prefijos, AND). */
export type ShelfFilter = "all" | "saved" | "mine";

export function shelfListings(
  userId: string,
  shelf: ShelfFilter = "all",
  page = 1,
): PagedListings {
  const condition =
    shelf === "saved"
      ? "f.user_id IS NOT NULL"
      : shelf === "mine"
        ? "l.owner_id = @userId"
        : "(f.user_id IS NOT NULL OR l.owner_id = @userId)";

  const db = getDb();
  const where = `WHERE ${VISIBILITY} AND ${OWNER_ACTIVE} AND ${condition}`;
  const { total } = db
    .prepare(
      `SELECT COUNT(*) AS total FROM listings l JOIN users u ON u.id = l.owner_id
       LEFT JOIN favorites f ON f.listing_id = l.id AND f.user_id = @userId
       ${where}`,
    )
    .get({ userId }) as { total: number };

  const safePage = Math.max(1, page);
  const distance = distanceParts(userId);
  const rows = db
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join}
       ${where}
       ORDER BY l.created_at DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({
      userId,
      fromCity: distance.fromCity,
      limit: PAGE_SIZE,
      offset: (safePage - 1) * PAGE_SIZE,
    }) as ListingRow[];

  return {
    items: rows.map((row) => toListingView(row, userId)),
    total,
    page: safePage,
    pageSize: PAGE_SIZE,
    hasMore: safePage * PAGE_SIZE < total,
  };
}

export function getListing(id: string, viewerId: string | null): ListingView | null {
  // Un ejemplar pausado deja de ser público: solo lo ve quien lo publicó.
  const distance = distanceParts(viewerId);
  const row = getDb()
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join}
       WHERE l.id = @id AND ${VISIBILITY} AND ${OWNER_ACTIVE}
         AND (l.status <> 'paused' OR l.owner_id = @userId)
         AND ${blockPair("@userId", "l.owner_id")}`,
    )
    .get({
      id,
      userId: viewerId ?? "",
      fromCity: distance.fromCity,
    }) as ListingRow | undefined;
  return row ? toListingView(row, viewerId) : null;
}

/** Las etiquetas son curadas y se guardan como conjunto por ejemplar. */
function writeListingTags(db: Db, listingId: string, tags: string[]): void {
  db.prepare("DELETE FROM listing_tags WHERE listing_id = ?").run(listingId);
  const insert = db.prepare("INSERT OR IGNORE INTO listing_tags (listing_id, tag) VALUES (?, ?)");
  for (const tag of tags.slice(0, 3)) insert.run(listingId, tag);
}

export function createListing(ownerId: string, input: ListingInputOpcional): ListingView {
  const db = getDb();
  const owner = getUserById(ownerId);
  if (!owner) throw new ApiError(401, "Necesitas iniciar sesión.");
  assertVerified(ownerId);

  const city = input.city ?? owner.city;
  const language = input.language ?? "No especificado";
  const titleKey = normalizeText(input.title);
  const searchKey = normalizeText(`${input.title} ${input.author} ${city}`);
  const now = nowIso();
  // La portada llega después, subida a mano (`/api/cover/book/<id>`).
  const coverUrl: string | null = null;
  // Clave de obra: la de Open Library (agrupa traducciones) o, si no se
  // conoce, la derivada del título y la autoría. La segunda sirve para unir
  // las ediciones que ya estén en el catálogo con la misma fórmula.
  const hashWorkKey = workKeyFromTitle(input.title, input.author);
  const cached = input.isbn ? cachedIsbnMetadata(input.isbn) : null;
  const workKey = cached?.workId ? workKeyFromOpenLibrary(cached.workId) : hashWorkKey;

  const listId = db.transaction(() => {
    const book = input.isbn
      ? (db.prepare("SELECT id FROM books WHERE isbn = ?").get(input.isbn) as { id: string } | undefined)
      : (db
          .prepare("SELECT id FROM books WHERE title_key = ? AND lower(author) = lower(?)")
          .get(titleKey, input.author) as { id: string } | undefined);

    let bookId = book?.id;
    if (!bookId) {
      const newBookId = `bok_${randomUUID()}`;
      try {
        db.prepare(
          "INSERT INTO books (id, title, title_key, author, isbn, category, language, cover_url, work_key, publisher, year, series, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          newBookId,
          input.title,
          titleKey,
          input.author,
          input.isbn,
          input.category,
          language,
          coverUrl,
          workKey,
          // Ficha bibliográfica de la edición, tal como la dio el catálogo.
          cached?.publisher ?? null,
          cached?.year ?? null,
          cached?.series ?? null,
          now,
        );
        bookId = newBookId;
      } catch (error) {
        // Dos publicaciones simultáneas del mismo ISBN: la segunda reutiliza
        // el libro que acaba de crear la primera.
        if (!input.isbn || !isConstraintError(error)) throw error;
        const existing = db.prepare("SELECT id FROM books WHERE isbn = ?").get(input.isbn) as
          | { id: string }
          | undefined;
        if (!existing) throw error;
        bookId = existing.id;
      }
    }

    const listingId = `lst_${randomUUID()}`;
    // El libro pudo existir ya (mismo ISBN o mismo título): se le asegura la
    // clave de obra y, si ahora se conoce la de Open Library, las ediciones que
    // estaban con la clave derivada pasan a la buena para quedar agrupadas.
    db.prepare("UPDATE books SET work_key = ? WHERE id = ? AND (work_key IS NULL OR work_key = '')").run(
      workKey,
      bookId,
    );
    if (workKey !== hashWorkKey) {
      db.prepare("UPDATE books SET work_key = ? WHERE work_key = ? AND id <> ?").run(
        workKey,
        hashWorkKey,
        bookId,
      );
    }
    // Si la edición ya existía sin idioma, la primera persona que lo sepa lo
    // completa; no se pisa un idioma ya indicado.
    if (input.language && input.language !== "No especificado") {
      db.prepare("UPDATE books SET language = ? WHERE id = ? AND language = 'No especificado'").run(
        input.language,
        bookId,
      );
    }
    db.prepare(
      `INSERT INTO listings (id, book_id, owner_id, condition, city, distance_km, status, search_key, notes, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'available', ?, '', ?)`,
    ).run(listingId, bookId, ownerId, input.condition, city, searchKey, now);

    db.prepare(
      "INSERT INTO events (id, type, actor_id, listing_id, request_id, created_at) VALUES (?, 'published', ?, ?, NULL, ?)",
    ).run(`evt_${randomUUID()}`, ownerId, listingId, now);

    writeListingTags(db, listingId, input.tags);

    return listingId;
  })();

  const listing = getListing(listId, ownerId);
  if (!listing) throw new ApiError(500, "No se pudo publicar el libro.");
  // Aviso a quien sigue la ciudad (bandeja interna, sin correo).
  notifyAvailability({
    ownerId,
    city,
    title: input.title,
    listingId: listId,
    bookId: listing.bookId,
  });
  notifyBookWants({
    ownerId,
    city,
    title: input.title,
    listingId: listId,
    bookId: listing.bookId,
  });
  return listing;
}

export function setListingStatus(
  ownerId: string,
  listingId: string,
  status: "available" | "paused",
): void {
  const db = getDb();
  // La comprobación va dentro del UPDATE: así dos peticiones simultáneas no
  // pueden saltarse la regla entre el SELECT y la escritura.
  const { changes } = db
    .prepare(
      `UPDATE listings SET status = ?
       WHERE id = ? AND owner_id = ? AND status IN ('available','paused')`,
    )
    .run(status, listingId, ownerId);

  if (changes === 0) {
    const row = db
      .prepare("SELECT owner_id, status FROM listings WHERE id = ? AND status <> 'removed'")
      .get(listingId) as { owner_id: string; status: ListingStatus } | undefined;
    if (!row) throw new ApiError(404, "El ejemplar no existe.");
    if (row.owner_id !== ownerId) {
      throw new ApiError(403, "Solo puedes gestionar tus publicaciones.");
    }
    throw new ApiError(409, "No puedes cambiar la disponibilidad de un ejemplar reservado o entregado.");
  }
}

/** Edita los datos propios del ejemplar (no los del libro, que se comparte). */
export function editListing(
  ownerId: string,
  listingId: string,
  patch: {
    condition: string;
    city: string;
    notes: string;
    tags: string[];
    /** Ficha de la obra: solo se toca lo que llega. */
    title?: string;
    author?: string;
    category?: string;
    language?: string;
    publisher?: string;
    year?: string;
    series?: string;
  },
): void {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT l.owner_id, l.status, l.book_id, b.title, b.author
       FROM listings l JOIN books b ON b.id = l.book_id
       WHERE l.id = ? AND l.status <> 'removed'`,
    )
    .get(listingId) as
    | { owner_id: string; status: ListingStatus; book_id: string; title: string; author: string }
    | undefined;

  if (!row) throw new ApiError(404, "El ejemplar no existe.");
  if (row.owner_id !== ownerId) throw new ApiError(403, "Solo puedes editar tus publicaciones.");

  const title = patch.title?.trim() || row.title;
  const author = patch.author?.trim() || row.author;

  db.transaction(() => {
    // La ficha cuelga de la **obra**, así que corregirla afecta a todas sus
    // copias: es lo que se espera de una errata, pero conviene tenerlo claro.
    const bookFields: [string, string | null][] = [];
    if (patch.title !== undefined) {
      bookFields.push(["title", title], ["title_key", normalizeText(title)]);
    }
    if (patch.author !== undefined) bookFields.push(["author", author]);
    if (patch.category !== undefined) bookFields.push(["category", patch.category]);
    if (patch.language !== undefined) bookFields.push(["language", patch.language]);
    if (patch.publisher !== undefined) bookFields.push(["publisher", patch.publisher.trim() || null]);
    if (patch.year !== undefined) bookFields.push(["year", patch.year.trim() || null]);
    if (patch.series !== undefined) bookFields.push(["series", patch.series.trim() || null]);

    if (bookFields.length > 0) {
      db.prepare(
        `UPDATE books SET ${bookFields.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`,
      ).run(...bookFields.map(([, value]) => value), row.book_id);

      // `search_key` es el texto plano de la búsqueda: se recalcula en todas
      // las copias de la obra, no solo en esta.
      const copies = db.prepare("SELECT id, city FROM listings WHERE book_id = ?").all(row.book_id) as {
        id: string;
        city: string;
      }[];
      const updateSearch = db.prepare("UPDATE listings SET search_key = ? WHERE id = ?");
      for (const copy of copies) {
        updateSearch.run(normalizeText(`${title} ${author} ${copy.city}`), copy.id);
      }
    }

    db.prepare(
      "UPDATE listings SET condition = ?, city = ?, notes = ?, search_key = ? WHERE id = ?",
    ).run(
      patch.condition,
      patch.city,
      patch.notes,
      normalizeText(`${title} ${author} ${patch.city}`),
      listingId,
    );
    writeListingTags(db, listingId, patch.tags);
  })();
}

export function removeListing(ownerId: string, listingId: string): void {
  const db = getDb();
  const now = nowIso();
  let changes = 0;

  db.transaction(() => {
    // Estado y dueño se comprueban en el propio UPDATE (sin ventana TOCTOU).
    changes = db
      .prepare(
        `UPDATE listings SET status = 'removed'
         WHERE id = ? AND owner_id = ? AND status IN ('available','paused','given')`,
      )
      .run(listingId, ownerId).changes;
    if (changes === 0) return;
    db.prepare(
      "UPDATE requests SET status = 'expired', updated_at = ? WHERE listing_id = ? AND status = 'pending'",
    ).run(now, listingId);
  })();

  if (changes === 0) {
    const row = db
      .prepare("SELECT owner_id, status FROM listings WHERE id = ? AND status <> 'removed'")
      .get(listingId) as { owner_id: string; status: ListingStatus } | undefined;
    if (!row) throw new ApiError(404, "El ejemplar no existe.");
    if (row.owner_id !== ownerId) {
      throw new ApiError(403, "Solo puedes gestionar tus publicaciones.");
    }
    throw new ApiError(409, "Tienes un intercambio aceptado: cancélalo antes de retirar el libro.");
  }
}

export function setFavorite(userId: string, listingId: string, favorite: boolean): void {
  const db = getDb();
  const listing = db
    .prepare(
      `SELECT 1 FROM listings l JOIN users u ON u.id = l.owner_id
       WHERE l.id = ? AND l.status <> 'removed' AND u.is_suspended = 0`,
    )
    .get(listingId);
  if (!listing) throw new ApiError(404, "El ejemplar no existe.");
  if (favorite) {
    db.prepare(
      "INSERT OR IGNORE INTO favorites (user_id, listing_id, created_at) VALUES (?, ?, ?)",
    ).run(userId, listingId, nowIso());
  } else {
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND listing_id = ?").run(userId, listingId);
  }
}

/* ----------------------------- ficha de la obra ---------------------------- */

export type BookView = {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  category: string;
  language: string;
  coverUrl: string | null;
  /** Verlag, Erscheinungsjahr y Reihe de la edición (ficha de la DNB). */
  publisher: string | null;
  year: string | null;
  series: string | null;
};

type BookRow = {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  category: string;
  language: string;
  cover_url: string | null;
  publisher: string | null;
  year: string | null;
  series: string | null;
};

function toBookView(row: BookRow): BookView {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn: row.isbn,
    category: row.category,
    language: row.language,
    // Igual que en los ejemplares: las URLs de portada de versiones anteriores
    // (las de Open Library y las que se servían por ISBN) se anulan al leer, o
    // la ficha pediría una ruta que ya no existe.
    coverUrl: normalizeCoverUrl(row.cover_url),
    publisher: row.publisher ?? null,
    year: row.year ?? null,
    series: row.series ?? null,
  };
}

/** Obras que una cuenta tiene publicadas ahora mismo (para elegir lectura). */
export function listOwnerBooks(userId: string): { id: string; title: string; author: string }[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT b.id, b.title, b.author
       FROM listings l JOIN books b ON b.id = l.book_id
       WHERE l.owner_id = ? AND l.status <> 'removed'
       ORDER BY b.title COLLATE NOCASE ASC
       LIMIT 100`,
    )
    .all(userId) as { id: string; title: string; author: string }[];
  return rows;
}

/**
 * Busca obras del catálogo por título o autoría.
 *
 * Antes, para elegir la lectura de un club solo se ofrecían los libros que el
 * dueño tenía publicados: un club no podía leer algo que su fundador no tuviera
 * en casa. Esta búsqueda permite elegir cualquier obra que ya exista en el
 * catálogo (la conversación y los ejemplares cuelgan de la obra, no de la
 * edición).
 */
export function searchBooks(query: string, limit = 8): { id: string; title: string; author: string }[] {
  const terms = query
    .trim()
    .replace(/[%_]/g, "")
    .slice(0, 60);
  if (terms.length < 2) return [];
  const tope = Math.min(Math.max(limit, 1), 20);
  const db = getDb();

  // Primero el índice FTS: resuelve prefijos de palabra sin distinguir acentos
  // («infínito» → «infinito») sin recorrer la tabla.
  const tokens = normalizeText(terms).split(" ").filter(Boolean);
  if (tokens.length > 0) {
    const porIndice = db
      .prepare(
        `SELECT id, title, author FROM books
          WHERE rowid IN (SELECT rowid FROM books_fts WHERE books_fts MATCH @match)
          ORDER BY (title LIKE @prefijo COLLATE NOCASE) DESC, length(title) ASC,
                   title COLLATE NOCASE ASC
          LIMIT @limit`,
      )
      .all({ match: ftsQuery(tokens), prefijo: `${terms}%`, limit: tope }) as {
      id: string;
      title: string;
      author: string;
    }[];
    if (porIndice.length > 0) return porIndice;
  }

  // Nadie escribe las palabras por el principio: si el término cae a media
  // palabra, el índice no lo encuentra y se recurre a la subcadena. Solo se
  // paga ese recorrido cuando el índice no devolvió nada.
  const like = `%${terms}%`;
  return db
    .prepare(
      `SELECT id, title, author FROM books
        WHERE unaccent(title) LIKE unaccent(@like) OR unaccent(author) LIKE unaccent(@like)
        ORDER BY (unaccent(title) LIKE unaccent(@prefijo)) DESC, length(title) ASC,
                 title COLLATE NOCASE ASC
        LIMIT @limit`,
    )
    .all({ like, prefijo: `${terms}%`, limit: tope }) as {
    id: string;
    title: string;
    author: string;
  }[];
}

/** Obra canónica: es donde vive la conversación de un título. */
export function getBook(bookId: string): BookView | null {
  const row = getDb()
    .prepare(
      "SELECT id, title, author, isbn, category, language, cover_url, publisher, year, series FROM books WHERE id = ?",
    )
    .get(bookId) as BookRow | undefined;
  return row ? toBookView(row) : null;
}

/**
 * Obra por ISBN: es la que se reutiliza al publicar, así que el formulario
 * necesita saberlo antes de enviar para no descartar el título que se escribe.
 */
export function bookByIsbn(isbn: string): BookView | null {
  const row = getDb()
    .prepare(
      "SELECT id, title, author, isbn, category, language, cover_url, publisher, year, series FROM books WHERE isbn = ?",
    )
    .get(isbn) as BookRow | undefined;
  return row ? toBookView(row) : null;
}

/**
 * La portada de una obra solo la puede cambiar quien publica algún ejemplar
 * suyo (o la administración). Todas las copias comparten la misma obra, así que
 * la imagen vale para todas y nadie puede cambiarla desde fuera.
 */
export function canManageBookCover(bookId: string, userId: string, isAdmin = false): boolean {
  if (isAdmin) return true;
  const row = getDb()
    .prepare("SELECT 1 FROM listings WHERE book_id = ? AND owner_id = ? LIMIT 1")
    .get(bookId, userId);
  return Boolean(row);
}

export function bookExists(bookId: string): boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM books WHERE id = ?").get(bookId));
}

/** Guarda (o retira, con `null`) la portada de la obra. */
export function setBookCoverUrl(bookId: string, coverUrl: string | null): void {
  getDb().prepare("UPDATE books SET cover_url = ? WHERE id = ?").run(coverUrl, bookId);
}

/** Al quitar la portada subida la ficha queda sin imagen hasta que se suba otra. */
export function resetBookCover(bookId: string): void {
  const row = getDb().prepare("SELECT isbn FROM books WHERE id = ?").get(bookId) as
    | { isbn: string | null }
    | undefined;
  if (!row) return;
  setBookCoverUrl(bookId, null);
}

/** Copias disponibles de una obra, ordenadas por cercanía y estado. */
export function listingsForBook(
  bookId: string,
  viewerId: string | null,
  options: { city?: string; availableOnly?: boolean; limit?: number } = {},
): ListingView[] {
  const distance = distanceParts(viewerId);
  // Se incluyen las otras ediciones de la misma obra: para quien busca el libro
  // da igual la editorial de la copia.
  const scope = workIdsClause("l.book_id", workBookIds(bookId));
  // Los filtros van en SQL: filtrar después del LIMIT dejaba fuera ejemplares
  // de la ciudad del club si las primeras copias eran de otro sitio.
  const filters = [
    scope.clause,
    VISIBILITY,
    OWNER_ACTIVE,
    BLOCK_FILTER,
    options.city ? "l.city = @city" : "",
    options.availableOnly ? "l.status = 'available'" : "",
  ]
    .filter(Boolean)
    .join(" AND ");
  const rows = getDb()
    .prepare(
      `${listingSelect(distance.expression)} ${distance.join}
       WHERE ${filters}
       ORDER BY (l.status = 'available') DESC, distance_km IS NULL, distance_km ASC, l.created_at DESC
       LIMIT @limit`,
    )
    .all({
      ...scope.params,
      userId: viewerId ?? "",
      fromCity: distance.fromCity,
      limit: options.limit ?? 50,
      ...(options.city ? { city: options.city } : {}),
    }) as ListingRow[];
  return rows.map((row) => toListingView(row, viewerId));
}

/** Ejemplares visibles de una obra, sin el tope de la lista: da la cifra real. */
export function countListingsForBook(bookId: string, viewerId: string | null): number {
  const scope = workIdsClause("l.book_id", workBookIds(bookId));
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS value FROM listings l
        WHERE ${scope.clause} AND ${VISIBILITY} AND ${OWNER_ACTIVE} AND ${BLOCK_FILTER}`,
    )
    .get({ ...scope.params, userId: viewerId ?? "" }) as { value: number };
  return row.value;
}

/**
 * Todas las ediciones de la obra, la primera por antigüedad primero. Sirve para
 * enseñar «otras ediciones» en la ficha y para canonizar la URL de la obra.
 */
export function workBooks(bookId: string): BookView[] {
  const db = getDb();
  const row = db.prepare("SELECT work_key FROM books WHERE id = ?").get(bookId) as
    | { work_key: string | null }
    | undefined;
  const self = db
    .prepare(
      "SELECT id, title, author, isbn, category, language, cover_url, publisher, year, series FROM books WHERE id = ?",
    )
    .get(bookId) as BookRow | undefined;
  if (!row?.work_key || !self) return self ? [toBookView(self)] : [];
  const rows = db
    .prepare(
      `SELECT id, title, author, isbn, category, language, cover_url, publisher, year, series FROM books
        WHERE work_key = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .all(row.work_key) as BookRow[];
  return rows.length > 0 ? rows.map(toBookView) : [toBookView(self)];
}

/**
 * Obras del catálogo que corresponden a una clave de obra concreta, mirando
 * también por la clave derivada: sirve para avisar en el formulario de que la
 * obra ya existe aunque la edición (el ISBN) sea nueva.
 */
export function booksForWorkKeys(keys: readonly string[]): BookView[] {
  const clean = [...new Set(keys.filter(Boolean))];
  if (clean.length === 0) return [];
  const db = getDb();
  const params: Record<string, string> = {};
  const placeholders = clean.map((key, index) => {
    params[`key${index}`] = key;
    return `@key${index}`;
  });
  const rows = db
    .prepare(
      `SELECT id, title, author, isbn, category, language, cover_url, publisher, year, series FROM books
        WHERE work_key IN (${placeholders.join(",")})
        ORDER BY created_at ASC
        LIMIT 10`,
    )
    .all(params) as BookRow[];
  return rows.map(toBookView);
}
