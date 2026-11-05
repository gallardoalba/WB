import { handleApiError } from "@/lib/api";
import { getCover } from "@/lib/covers";
import { ApiError } from "@/lib/errors";
import { bookByIsbn } from "@/lib/repo";
import { normalizeIsbn } from "@/lib/text";
import { clientKey, hasClientIp, hit } from "@/lib/throttle";

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
    hit(
      hasClientIp()
        ? { bucket: "cover:ip", key: clientKey(request), limit: 300, windowMs: 60_000 }
        : { bucket: "cover", key: "all", limit: 3000, windowMs: 60_000 },
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

    return new Response(new Uint8Array(cover.data), {
      headers: {
        "content-type": cover.contentType,
        // Una portada no cambia: se puede cachear en el navegador una semana.
        "cache-control": "public, max-age=604800, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
