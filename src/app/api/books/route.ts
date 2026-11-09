import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { searchBooks } from "@/lib/repo";
import { hit } from "@/lib/throttle";

/**
 * Buscador de obras del catálogo, para elegir la lectura de un club o proponer
 * libros en una votación. Devuelve poco y solo con sesión: no es un buscador
 * público de la plataforma.
 *
 * Con cuota: lo llama el selector mientras se escribe (cada 350 ms), así que
 * sin límite una sola cuenta puede encadenar búsquedas sin parar.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    hit({ bucket: "books:search", key: user.id, limit: 240, windowMs: 60_000 });
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return json({ books: searchBooks(q) });
  } catch (error) {
    return handleApiError(error);
  }
}
