import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Portadas de libro servidas desde la propia aplicación.
 *
 * Antes el navegador pedía la imagen directamente a `covers.openlibrary.org`:
 * eso entregaba a un tercero la IP de cada lector y el ISBN que estaba mirando.
 * Ahora la petición la hace el servidor, se cachea en disco y el navegador solo
 * habla con nosotros.
 *
 * El host es fijo y el ISBN llega ya validado, así que no hay SSRF posible ni
 * escritura fuera de la carpeta de caché.
 */

/** Open Library: la portada de una edición concreta, por ISBN. */
const OPENLIBRARY_ISBN = "https://covers.openlibrary.org/b/isbn";
/** Google Books: a veces tiene la edición alemana que Open Library no tiene. */
const GOOGLE_BOOKS = "https://www.googleapis.com/books/v1/volumes?country=DE&q=isbn:";
/** Open Library: obra por título y autoría (la portada de otra edición). */
const OPENLIBRARY_SEARCH = "https://openlibrary.org/search.json";
/** Imagen suelta de Open Library, por identificador de portada. */
const OPENLIBRARY_COVER = "https://covers.openlibrary.org/b/id";
/** Una portada no cambia: se sirve desde caché sin volver a pedirla. */
const MAX_BYTES = 4 * 1024 * 1024;
/**
 * Open Library responde con un GIF de 1×1 (unas decenas de bytes) cuando no
 * tiene la portada. Una imagen real nunca baja de 1 KB, así que por debajo de
 * este umbral se considera que no hay portada.
 */
const MIN_BYTES = 1_000;
/** Cuánto se recuerda que un ISBN no tiene portada, para no repetir la búsqueda. */
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Versión de la lista de proveedores. Forma parte del nombre de la marca de
 * «sin portada»: al añadir una fuente nueva se sube el número y las marcas
 * antiguas dejan de aplicarse, sin borrar nada a mano.
 */
const MISS_VERSION = "v2";

/** Carpeta de caché: junto a la base de datos (volumen persistente). */
export function coverCacheDir(): string {
  const configured = process.env.WANDERBIBLIOTHEK_COVER_CACHE?.trim();
  if (configured) return configured;
  const db = process.env.WANDERBIBLIOTHEK_DB?.trim();
  const base = db ? path.dirname(db) : path.join(process.cwd(), ".data");
  return path.join(base, "covers");
}

/** Solo se admiten ISBN-10/13 normalizados: nada de rutas ni consultas. */
function isValidCacheKey(value: string): boolean {
  return /^[0-9]{9}[0-9X]$|^[0-9]{13}$/.test(value);
}

function cachePath(isbn: string): string {
  return path.join(coverCacheDir(), `${isbn}.img`);
}

function missPath(isbn: string): string {
  return path.join(coverCacheDir(), `${isbn}.${MISS_VERSION}.miss`);
}

/** Marca de «este ISBN no tiene portada»: evita repetir la petición cada visita. */
function recentMiss(isbn: string): boolean {
  try {
    return Date.now() - statSync(missPath(isbn)).mtimeMs < MISS_TTL_MS;
  } catch {
    return false;
  }
}

function markMiss(isbn: string): void {
  try {
    mkdirSync(coverCacheDir(), { recursive: true, mode: 0o700 });
    writeFileSync(missPath(isbn), "", { mode: 0o600 });
  } catch {
    // Sin marca se repetirá la búsqueda: no se pierde nada.
  }
}

/** Tipo por los primeros bytes: así no hace falta un fichero de metadatos. */
function sniffImageType(data: Buffer): string | null {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (data.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export type Cover = { data: Buffer; contentType: string };

function readCache(isbn: string): Cover | null {
  try {
    const data = readFileSync(cachePath(isbn));
    // Restos de la versión anterior, que guardaba el 1×1 del proveedor.
    if (data.length < MIN_BYTES) {
      unlinkSync(cachePath(isbn));
      return null;
    }
    const contentType = sniffImageType(data);
    return contentType ? { data, contentType } : null;
  } catch {
    return null;
  }
}

function writeCache(isbn: string, data: Buffer): void {
  try {
    const dir = coverCacheDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(cachePath(isbn), data, { mode: 0o600 });
  } catch (error) {
    // Sin caché se sigue sirviendo: solo se repite la descarga.
    console.warn("[cover] no se pudo guardar la portada en caché", error);
  }
}

/** Descarga y valida una imagen de portada. Cualquier fallo es «no hay». */
async function fetchImage(url: string): Promise<Cover | null> {
  const response = await fetch(url, {
    // Esperar aquí no bloquea la página: la tarjeta ya ocupa su sitio con el
    // fondo de color y la imagen entra cuando llega. Con un tope más corto se
    // perderían portadas reales solo porque el proveedor iba lento.
    signal: AbortSignal.timeout(4_000),
    headers: { "user-agent": "Wanderbibliothek/1.0 (portadas de libros)" },
  });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;

  const data = Buffer.from(await response.arrayBuffer());
  const contentType = sniffImageType(data);
  // Sin imagen reconocible, con el 1×1 de los proveedores o demasiado grande:
  // no es una portada utilizable.
  if (!contentType || data.length < MIN_BYTES || data.byteLength > MAX_BYTES) return null;
  return { data, contentType };
}

/**
 * ISBN-13 equivalente a un ISBN-10. Los servicios de portadas indexan casi
 * siempre por el 13, y las ediciones antiguas del catálogo están en 10.
 */
export function toIsbn13(isbn: string): string | null {
  if (isbn.length === 13) return isbn;
  if (isbn.length !== 10) return null;
  const base = `978${isbn.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(base[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return `${base}${(10 - (sum % 10)) % 10}`;
}

/** Open Library, edición exacta por ISBN. */
async function fromOpenLibraryIsbn(isbn: string): Promise<Cover | null> {
  const key = toIsbn13(isbn) ?? isbn;
  return fetchImage(`${OPENLIBRARY_ISBN}/${key}-L.jpg?default=false`);
}

/**
 * Variantes del título para buscar la obra: entera, sin el número de volumen
 * («… I», «… II», «Band 2») y sin la coletilla del subtítulo. Open Library es
 * muy literal: «Die Antiquiertheit des Menschen I» no encuentra nada y «Die
 * Antiquiertheit des Menschen» sí.
 */
export function titleVariants(title: string): string[] {
  const entero = title.trim().replace(/\s+/g, " ");
  if (!entero) return [];
  const variantes = [entero];
  const sinVolumen = entero
    .replace(/\s+(I{1,3}|IV|V|Bd\.?\s*\d+|Band\s*\d+)$/i, "")
    .trim();
  if (sinVolumen && sinVolumen !== entero) variantes.push(sinVolumen);
  const principal = entero
    .split(/\s*[:–—]\s*/)[0]
    .split(/\s+und\s+andere\b/i)[0]
    .trim();
  if (principal && !variantes.includes(principal)) variantes.push(principal);
  return variantes.slice(0, 3);
}

/**
 * Google Books por ISBN. Devuelve una miniatura con recorte (`edge=curl`);
 * se le pide el doble de tamaño y se cambia a https, que es lo que exige la
 * página para no mezclar orígenes.
 */
export function googleBooksCoverUrl(payload: unknown, isbn: string): string | null {
  const items = (payload as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const volume = item as {
      volumeInfo?: {
        imageLinks?: { thumbnail?: string; smallThumbnail?: string };
        industryIdentifiers?: { type?: string; identifier?: string }[];
      };
    };
    const identifiers = volume.volumeInfo?.industryIdentifiers ?? [];
    // La API devuelve a veces otra edición: solo vale si trae nuestro ISBN.
    if (!identifiers.some((entry) => (entry.identifier ?? "").replace(/-/g, "") === isbn)) {
      continue;
    }
    const raw = volume.volumeInfo?.imageLinks?.thumbnail ?? volume.volumeInfo?.imageLinks?.smallThumbnail;
    if (!raw) continue;
    return raw
      .replace(/^http:/, "https:")
      .replace(/&zoom=\d/, "&zoom=2")
      .replace(/&edge=curl/, "");
  }
  return null;
}

async function fromGoogleBooks(isbn: string): Promise<Cover | null> {
  // La cuota anónima de Google se agota enseguida; con clave propia (opcional)
  // el despliegue puede contar con esta fuente de verdad.
  const key = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  const indexed = toIsbn13(isbn) ?? isbn;
  const endpoint = `${GOOGLE_BOOKS}${indexed}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(4_000),
    headers: { "user-agent": "Wanderbibliothek/1.0 (portadas de libros)" },
  });
  if (!response.ok) return null;
  const imageUrl = googleBooksCoverUrl(await response.json().catch(() => null), isbn);
  return imageUrl ? fetchImage(imageUrl) : null;
}

/**
 * Open Library por obra: muchas ediciones alemanas no tienen portada propia,
 * pero la obra sí tiene la de otra edición. Se busca por título y autoría y se
 * usa la primera portada que aparezca.
 */
export async function openLibraryWorkCoverId(payload: unknown): Promise<number | null> {
  const docs = (payload as { docs?: unknown[] } | null)?.docs;
  if (!Array.isArray(docs)) return null;
  for (const doc of docs) {
    const cover = (doc as { cover_i?: unknown }).cover_i;
    if (typeof cover === "number" && cover > 0) return cover;
  }
  return null;
}

/** Minúsculas, sin acentos ni puntuación: para comparar títulos con criterio. */
function normaliza(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pares de letras consecutivas: base de la comparación de títulos. */
function bigramas(texto: string): Set<string> {
  const plano = texto.replace(/ /g, "");
  const pares = new Set<string>();
  for (let index = 0; index < plano.length - 1; index += 1) {
    pares.add(plano.slice(index, index + 2));
  }
  return pares;
}

/**
 * ¿Es la misma obra? Se acepta si un título contiene al otro o si se parecen
 * lo suficiente. Sin esto, una búsqueda por título devolvía la portada de
 * cualquier libro que compartiera un par de palabras.
 */
export function titlesMatch(consulta: string, candidato: string): boolean {
  const a = normaliza(consulta);
  const b = normaliza(candidato);
  if (!a || !b) return false;
  if (a === b || b.includes(a) || a.includes(b)) return true;
  const paresA = bigramas(a);
  const paresB = bigramas(b);
  if (paresA.size === 0 || paresB.size === 0) return false;
  let comunes = 0;
  for (const par of paresA) if (paresB.has(par)) comunes += 1;
  return (2 * comunes) / (paresA.size + paresB.size) >= 0.62;
}

/** El apellido de quien firma tiene que aparecer entre las autorías. */
export function authorMatches(consulta: string, nombres: string[]): boolean {
  const apellido = normaliza(consulta).split(" ").filter(Boolean).pop();
  if (!apellido) return true;
  return nombres.some((nombre) => normaliza(nombre).includes(apellido));
}

export function pickWorkCover(
  payload: unknown,
  title: string,
  author: string,
): number | null {
  const docs = (payload as { docs?: unknown[] } | null)?.docs;
  if (!Array.isArray(docs)) return null;
  const entradas = docs.map((doc) => {
    const entrada = doc as { cover_i?: unknown; title?: unknown; author_name?: unknown };
    return {
      cover: typeof entrada.cover_i === "number" ? entrada.cover_i : 0,
      title: typeof entrada.title === "string" ? entrada.title : "",
      autores: Array.isArray(entrada.author_name)
        ? entrada.author_name.filter((name): name is string => typeof name === "string")
        : [],
    };
  });

  // Primero la edición cuyo título coincide: es la portada correcta.
  const mismaObra = entradas.find(
    (entrada) =>
      entrada.cover > 0 &&
      titlesMatch(title, entrada.title) &&
      (entrada.autores.length === 0 || authorMatches(author, entrada.autores)),
  );
  if (mismaObra) return mismaObra.cover;

  // Si la edición no tiene portada, se acepta la de otra edición de la misma
  // obra (la traducción inglesa, por ejemplo), pero solo entre los dos primeros
  // resultados y solo si firma la misma persona: «Die Antiquiertheit des
  // Menschen» acaba enseñando la portada de «One-Dimensional Man» antes que una
  // portadilla en blanco, pero nunca la de un libro de otro autor.
  if (!author.trim()) return null;
  for (const entrada of entradas.slice(0, 2)) {
    if (entrada.cover > 0 && authorMatches(author, entrada.autores)) return entrada.cover;
  }
  return null;
}

async function fromOpenLibraryWork(title: string, author: string): Promise<Cover | null> {
  // La búsqueda por campos (`title=`, `author=`) es demasiado estricta: «Die
  // Antiquiertheit des Menschen I» no encuentra nada. La búsqueda general sí
  // encuentra la obra, así que se prueba primero título y autoría juntos y,
  // si no hay suerte, solo el título.
  const consultas = titleVariants(title).map((variante) =>
    `${variante} ${author}`.trim(),
  );
  for (const q of consultas) {
    if (!q) continue;
    const query = new URLSearchParams({ q, limit: "5", fields: "cover_i,title,author_name" });
    const response = await fetch(`${OPENLIBRARY_SEARCH}?${query.toString()}`, {
      signal: AbortSignal.timeout(4_000),
      headers: { "user-agent": "Wanderbibliothek/1.0 (portadas de libros)" },
    });
    if (!response.ok) continue;
    const coverId = pickWorkCover(
      await response.json().catch(() => null),
      title,
      author,
    );
    if (coverId) return fetchImage(`${OPENLIBRARY_COVER}/${coverId}-L.jpg?default=false`);
  }
  return null;
}

/**
 * Resuelve con la primera portada que llegue. Las demás peticiones siguen su
 * curso y se descartan: no hay forma de cancelarlas sin abortar también la que
 * ha ganado.
 */
async function firstCover(tareas: (() => Promise<Cover | null>)[]): Promise<Cover | null> {
  return new Promise((resolve) => {
    let pendientes = tareas.length;
    let resuelto = false;
    for (const tarea of tareas) {
      tarea()
        .then((cover) => {
          if (cover && !resuelto) {
            resuelto = true;
            resolve(cover);
          }
        })
        .catch((error: unknown) => {
          // Un proveedor caído no puede impedir que respondan los demás.
          console.warn("[cover] un proveedor falló", error);
        })
        .finally(() => {
          pendientes -= 1;
          if (pendientes === 0 && !resuelto) {
            resuelto = true;
            resolve(null);
          }
        });
    }
    if (tareas.length === 0) resolve(null);
  });
}

/**
 * Devuelve la portada o null. Nunca lanza por un fallo de los proveedores: la
 * ficha del libro muestra su portadilla generada cuando no hay imagen.
 *
 * Se prueban varias fuentes en orden (la primera que tenga la imagen gana) y el
 * resultado se guarda en caché, así que solo se paga la primera visita.
 */
export async function getCover(
  isbn: string,
  extra: { title?: string | null; author?: string | null } = {},
): Promise<Cover | null> {
  if (!isValidCacheKey(isbn)) return null;

  const cached = readCache(isbn);
  if (cached) return cached;
  // Ya se comprobó hace poco que no hay portada: no se vuelve a molestar.
  if (recentMiss(isbn)) return null;

  const proveedores: (() => Promise<Cover | null>)[] = [
    () => fromOpenLibraryIsbn(isbn),
    () => fromGoogleBooks(isbn),
  ];
  if (extra.title) {
    const title = extra.title;
    const author = extra.author ?? "";
    proveedores.push(() => fromOpenLibraryWork(title, author));
  }

  // Los proveedores se consultan en paralelo y gana el primero que trae una
  // imagen: en serie, un ISBN que no está en ningún servicio se pasaba diez
  // segundos esperando timeouts antes de pintar la portadilla.
  const cover = await firstCover(proveedores);
  if (cover) {
    writeCache(isbn, cover.data);
    return cover;
  }

  markMiss(isbn);
  return null;
}

/* --------------------------- portadas subidas ---------------------------- */

/**
 * Portada subida por quien publica el ejemplar.
 *
 * Se guarda junto a la caché pero con nombre propio (`upload-<bookId>.img`), y
 * `books.cover_url` pasa a apuntar a `/api/cover/book/<bookId>`. Así todas las
 * copias de la misma obra enseñan la misma imagen y nadie puede cambiar la
 * portada de un libro que no publica.
 */
export function uploadedCoverPath(bookId: string): string | null {
  if (!/^bok_[A-Za-z0-9-]{1,40}$/.test(bookId)) return null;
  return path.join(coverCacheDir(), `upload-${bookId}.img`);
}

export function readUploadedCover(bookId: string): Cover | null {
  const file = uploadedCoverPath(bookId);
  if (!file) return null;
  try {
    const data = readFileSync(file);
    const contentType = sniffImageType(data);
    return contentType ? { data, contentType } : null;
  } catch {
    return null;
  }
}

export function saveUploadedCover(bookId: string, data: Buffer): Cover | null {
  const file = uploadedCoverPath(bookId);
  const contentType = sniffImageType(data);
  if (!file || !contentType) return null;
  if (data.length < MIN_BYTES || data.byteLength > MAX_BYTES) return null;
  mkdirSync(coverCacheDir(), { recursive: true, mode: 0o700 });
  writeFileSync(file, data, { mode: 0o600 });
  return { data, contentType };
}

export function removeUploadedCover(bookId: string): void {
  const file = uploadedCoverPath(bookId);
  if (!file) return;
  try {
    unlinkSync(file);
  } catch {
    // No había portada subida: nada que borrar.
  }
}

/**
 * Borra portadas y marcas que nadie ha pedido en mucho tiempo. Se llama desde el
 * cron de mantenimiento: sin esto la caché crecería con cada ISBN visitado.
 */
export function pruneCoverCache(days = 180): number {
  const dir = coverCacheDir();
  let entries: string[];
  try {
    // La carpeta se decide en tiempo de ejecución (`WANDERBIBLIOTHEK_DB`), así
    // que el empaquetador no puede saberla: sin esta marca, Turbopack mete el
    // proyecto entero en el bundle del servidor solo por esta llamada.
    entries = readdirSync(/* turbopackIgnore: true */ dir);
  } catch {
    return 0;
  }
  const limit = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".img") && !entry.endsWith(".miss")) continue;
    // Las portadas subidas son datos de las personas, no caché: se quedan.
    if (entry.startsWith("upload-")) continue;
    const file = path.join(dir, entry);
    try {
      if (statSync(file).mtimeMs < limit) {
        unlinkSync(file);
        removed += 1;
      }
    } catch {
      // Fichero ya borrado por otra pasada.
    }
  }
  return removed;
}
