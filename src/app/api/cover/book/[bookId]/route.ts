import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { toJpeg } from "@/lib/cover-convert";
import { readUploadedCover, removeUploadedCover, saveUploadedCover } from "@/lib/covers";
import { ApiError } from "@/lib/errors";
import {
  assertVerified,
  bookExists,
  canManageBookCover,
  resetBookCover,
  setBookCoverUrl,
} from "@/lib/repo";
import { invalidatePublicData } from "@/lib/revalidate";
import { guard } from "@/lib/throttle";

/** Una portada pesa poco: 4 MB es de sobra para una foto de la contraportada. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Portada subida por quien publica la obra.
 *
 * Va en su propia ruta (y no en la del ISBN) porque la imagen es del ejemplar
 * creado por una persona, no de una edición concreta: `books.cover_url` apunta
 * aquí y todas las copias de esa obra enseñan la misma.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  try {
    const { bookId } = await params;
    const cover = readUploadedCover(bookId);
    if (!cover) {
      return new Response(null, {
        status: 404,
        headers: { "cache-control": "public, max-age=60" },
      });
    }
    return new Response(new Uint8Array(cover.data), {
      headers: {
        "content-type": cover.contentType,
        // La imagen cambia si quien publica la sustituye: se revalida a menudo.
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Sube la portada de una obra. El cuerpo es la imagen en crudo (`PUT` con
 * `image/*`), no un formulario: así un formulario cross-site no puede usarlo
 * —no puede enviar ese `Content-Type`— y el guardia de origen lo cierra del
 * todo. El tipo real se comprueba por los primeros bytes, no por lo declarado.
 *
 * Se acepta JPG y PNG; el PNG se convierte a JPG antes de guardarlo, de modo que
 * la política de almacenamiento sigue siendo una sola (`saveUploadedCover`)
 * venga la imagen de donde venga.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  try {
    const user = await requireUser();
    const { bookId } = await params;
    guard(request, { bucket: "cover:upload", key: user.id, limit: 20, windowMs: 24 * 60 * 60 * 1000 });

    if (!bookExists(bookId)) throw new ApiError(404, "Esa obra no existe.");
    if (!canManageBookCover(bookId, user.id, user.isAdmin)) {
      throw new ApiError(403, "Solo quien publica el libro puede cambiar su portada.");
    }
    assertVerified(user.id);

    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new ApiError(413, "La imagen pesa demasiado (máximo 4 MB).");
    }
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.byteLength > MAX_BYTES) {
      throw new ApiError(413, "La imagen pesa demasiado (máximo 4 MB).");
    }
    // El PNG se convierte aquí; un JPG pasa tal cual. Lanza 415/422/413 si no
    // es ninguna de las dos cosas o si no se puede leer.
    const data = toJpeg(raw);
    // Un PNG de 4 MB puede crecer al recomprimirlo —raro, pero pasa con texturas
    // y ruido—: sin esta comprobación el rechazo saldría como «pesa menos de
    // 1 KB», que no explica nada.
    if (data.byteLength > MAX_BYTES) {
      throw new ApiError(
        413,
        "La imagen ocupa demasiado al convertirla a JPG: usa una más pequeña o reduce su tamaño.",
      );
    }

    const saved = saveUploadedCover(bookId, data);
    if (!saved) {
      throw new ApiError(
        422,
        "El archivo no es una portada válida o pesa menos de 1 KB: sube una foto en JPG o PNG (máximo 4 MB).",
      );
    }

    const coverUrl = `/api/cover/book/${bookId}`;
    setBookCoverUrl(bookId, coverUrl);
    invalidatePublicData();
    return json({ coverUrl });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Quita la portada subida y vuelve a dejar que el servidor busque la del ISBN. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  try {
    const user = await requireUser();
    const { bookId } = await params;
    guard(request, { bucket: "cover:upload", key: user.id, limit: 20, windowMs: 24 * 60 * 60 * 1000 });

    if (!bookExists(bookId)) throw new ApiError(404, "Esa obra no existe.");
    if (!canManageBookCover(bookId, user.id, user.isAdmin)) {
      throw new ApiError(403, "Solo quien publica el libro puede cambiar su portada.");
    }

    removeUploadedCover(bookId);
    resetBookCover(bookId);
    invalidatePublicData();
    return json({ coverUrl: null });
  } catch (error) {
    return handleApiError(error);
  }
}
