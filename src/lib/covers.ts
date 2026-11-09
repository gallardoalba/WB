import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Portadas de libro servidas desde la propia aplicación.
 *
 * Solo se sirve **lo que sube quien publica el ejemplar**: la aplicación ya no
 * descarga portadas de terceros a partir del ISBN. Aquel camino mandaba datos a
 * Open Library y Google Books y, cuando no había imagen, dejaba el hueco a una
 * portadilla escrita; ahora la portada es un dato obligatorio del alta y la
 * imagen se queda en disco, junto a la base de datos.
 */

/** Una portada no cambia: se sirve desde disco sin volver a pedirla. */
const MAX_BYTES = 4 * 1024 * 1024;
/** Por debajo de este tamaño no es una imagen de verdad (ni un JPG válido). */
const MIN_BYTES = 1_000;

/** Carpeta de portadas: junto a la base de datos (volumen persistente). */
export function coverCacheDir(): string {
  const configured = process.env.WANDERBIBLIOTHEK_COVER_CACHE?.trim();
  if (configured) return configured;
  const db = process.env.WANDERBIBLIOTHEK_DB?.trim();
  const base = db ? path.dirname(db) : path.join(process.cwd(), ".data");
  return path.join(base, "covers");
}

export type Cover = { data: Buffer; contentType: string };

/** Tipo real de la imagen por sus primeros bytes; el `Content-Type` lo pone quien sube. */
function sniffImageType(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  return null;
}

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

/**
 * Lo que se guarda como portada subida es siempre JPG, y solo JPG.
 *
 * La interfaz acepta además PNG porque `cover-convert.ts` lo convierte antes de
 * llegar aquí; esta capa se queda como última puerta y no negocia formatos.
 * Se comprueba por los primeros bytes (`FF D8 FF`), no por la extensión ni por
 * el `Content-Type` declarado: los dos los elige quien sube el archivo.
 */
export function isJpegCover(data: Buffer): boolean {
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

export function saveUploadedCover(bookId: string, data: Buffer): Cover | null {
  const file = uploadedCoverPath(bookId);
  const contentType = sniffImageType(data);
  // Una sola política para la interfaz y para el servidor: JPG. Se mira el
  // contenido, no la extensión ni el `Content-Type`, que los pone quien sube.
  if (!file || !contentType || !isJpegCover(data)) return null;
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
