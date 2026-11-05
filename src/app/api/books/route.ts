import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { searchBooks } from "@/lib/repo";

/**
 * Buscador de obras del catálogo, para elegir la lectura de un club o proponer
 * libros en una votación. Devuelve poco y solo con sesión: no es un buscador
 * público de la plataforma.
 */
export async function GET(request: Request) {
  try {
    await requireUser();
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return json({ books: searchBooks(q) });
  } catch (error) {
    return handleApiError(error);
  }
}
