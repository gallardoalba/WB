import { handleApiError } from "@/lib/api";
import { getCover } from "@/lib/covers";
import { ApiError } from "@/lib/errors";
import { bookByIsbn } from "@/lib/repo";
import { normalizeIsbn } from "@/lib/text";
import { clientKey, hasClientIp, hit } from "@/lib/throttle";
import { createHash } from "node:crypto";

/** ETag del contenido: las portadas son inmutables por ISBN. */
function coverTag(data: Buffer): string {
  return `"${createHash("sha1").update(data).digest("base64url")}"`;
}

/**
 * Portada de un ISBN, servida desde la propia aplicación.
 *
 * Existe para que el navegador no hable con Open Library: ver `lib/covers.ts`.
 * Es una imagen pública, así que se puede cachear (una portada no cambia).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ isbn: string }> },
) {
  try {
    // Los ISBN de la caché no se pueden adivinar sin recorrer el catálogo, pero
    // un barrido sí: se limita por cliente. Sin proxy de confianza todas las
    // peticiones comparten clave, así que el tope global es holgado.
    //
    // Cada ISBN que no está en caché cuesta hasta tres peticiones salientes de
    // 4 s (Open Library, Google Books y la búsqueda por obra): un barrido con
    // ISBN aleatorios genera salida y CPU aunque nunca haya imágenes, así que
    // el tope es más bajo que el de una lectura normal.
    hit(
      hasClientIp()
        ? { bucket: "cover:ip", key: clientKey(request), limit: 120, windowMs: 60_000 }
        : { bucket: "cover", key: "all", limit: 1_200, windowMs: 60_000 },
    );

    const { isbn: raw } = await params;
    const isbn = normalizeIsbn(raw);
    if (!isbn) throw new ApiError(404, "No encontrado.");

    // Si la edición no tiene portada en ningún servicio se busca la obra por
    // título y autoría: muchas ediciones alemanas solo existen así.
    const book = bookByIsbn(isbn);
    const cover = await getCover(isbn, { title: book?.title, author: book?.author });
    if (!cover) {
      return new Response(null, {
        status: 404,
        headers: { "cache-control": "public, max-age=3600" },
      });
    }

    const etag = coverTag(cover.data);
    const inm = request.headers.get("if-none-match");
    if (inm && inm.split(",").some((value) => value.trim() === etag)) {
      return new Response(null, {
        status: 304,
        headers: { etag, "cache-control": "public, max-age=604800" },
      });
    }

    return new Response(new Uint8Array(cover.data), {
      headers: {
        "content-type": cover.contentType,
        // Una portada no cambia: se puede cachear en el navegador una semana.
        "cache-control": "public, max-age=604800, stale-while-revalidate=86400",
        // Con `etag`, una revalidación cuesta una respuesta vacía en vez de
        // volver a bajar la imagen; el hash se calcula sobre los bytes que ya
        // están en memoria (la caché de disco los ha leído igualmente).
        etag: coverTag(cover.data),
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
