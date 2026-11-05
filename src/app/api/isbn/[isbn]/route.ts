import { handleApiError, json } from "@/lib/api";
import { bookByIsbn, booksForWorkKeys } from "@/lib/repo";
import { clientKey, hasClientIp, hit } from "@/lib/throttle";
import { fetchIsbnMetadata, tagsFromSubjects } from "@/lib/isbn-metadata";
import { TAGS, tagsForCategory } from "@/lib/domain";
import { workKeyFromOpenLibrary, workKeyFromTitle } from "@/lib/work";
import { isValidIsbn, normalizeIsbn } from "@/lib/text";

type Context = { params: Promise<{ isbn: string }> };

/**
 * ¿Qué dice este ISBN?
 *
 * Devuelve lo que necesita el formulario para no pedir a mano nada deducible:
 * - `book`: la ficha que ya existe **con ese ISBN** (se reutiliza tal cual).
 * - `metadata`: título, autoría, idioma, categoría y etiquetas según la DNB y
 *   Open Library. `null` = «no hay datos», nunca «está mal».
 * - `editions`: otras ediciones de la **misma obra** que ya están en el
 *   catálogo, para publicar contra la obra existente en vez de duplicarla.
 *
 * La consulta externa la hace el servidor: el navegador no habla con terceros.
 */
export async function GET(request: Request, { params }: Context) {
  try {
    // Es una lectura pública; se limita para que no sirva de oráculo masivo.
    if (hasClientIp()) {
      hit({ bucket: "isbn:lookup:ip", key: clientKey(request), limit: 120, windowMs: 60_000 });
    } else {
      hit({ bucket: "isbn:lookup", key: "all", limit: 600, windowMs: 60_000 });
    }
    const isbn = normalizeIsbn((await params).isbn);
    if (!isbn || !isValidIsbn(isbn)) return json({ book: null, metadata: null, editions: [] });

    const book = bookByIsbn(isbn);
    if (book) {
      return json({
        book: { id: book.id, title: book.title, author: book.author, category: book.category },
        metadata: null,
        editions: [],
      });
    }

    const metadata = await fetchIsbnMetadata(isbn, (category, subjects) =>
      tagsFromSubjects(subjects, category ? tagsForCategory(category) : TAGS),
    );
    // Con los datos de la edición se sabe si la obra ya está en el catálogo con
    // otro ISBN (otra editorial, otro formato).
    const keys = metadata
      ? [
          workKeyFromTitle(metadata.title, metadata.authors[0] ?? ""),
          ...(metadata.workId ? [workKeyFromOpenLibrary(metadata.workId)] : []),
        ]
      : [];
    const editions = keys.length > 0 ? booksForWorkKeys(keys) : [];

    return json({
      book: null,
      metadata,
      editions: editions.map((edition) => ({
        id: edition.id,
        title: edition.title,
        author: edition.author,
        isbn: edition.isbn,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
