import { json } from "@/lib/api";
import { toJpeg } from "@/lib/cover-convert";
import { uploadedCoverResponse } from "@/lib/cover-response";
import {
  MIN_UPLOADED_COVER_BYTES,
  removeUploadedCover,
  saveUploadedCover,
} from "@/lib/covers";
import { ApiError } from "@/lib/errors";
import {
  assertVerified,
  bookExists,
  canManageBookCover,
  resetBookCover,
  setBookCoverUrl,
} from "@/lib/repo";
import { invalidatePublicData } from "@/lib/revalidate";
import { route } from "@/lib/route";

/** Una portada pesa poco: 4 MB es de sobra para una foto de la contraportada. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Portada subida por quien publica la obra.
 *
 * Va en su propia ruta (y no en la del ISBN) porque la imagen es del ejemplar
 * creado por una persona, no de una edición concreta: `books.cover_url` apunta
 * aquí y todas las copias de esa obra enseñan la misma.
 */
export const GET = route<undefined, "none", { bookId: string }>(
  { auth: "none" },
  ({ request, params }) => {
    const { bookId } = params;
    return uploadedCoverResponse(bookId, request);
  },
);

/**
 * Sube la portada de una obra. El cuerpo es la imagen en crudo (`PUT` con
 * `image/*`), no un formulario: así un formulario cross-site no puede usarlo
 * —no puede enviar ese `Content-Type`— y el guardia de origen lo cierra del
 * todo. El tipo real se comprueba por los primeros bytes, no por lo declarado.
 *
 * Se acepta JPG y PNG; el PNG se convierte a JPG y se eliminan los metadatos
 * antes de guardar, de modo que la política de almacenamiento sigue siendo una
 * sola (`saveUploadedCover`) venga la imagen de donde venga.
 */
export const PUT = route<undefined, "user", { bookId: string }>(
  { limit: { bucket: "cover:upload", limit: 20, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { bookId } = params;

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
    // El PNG se convierte aquí; al JPG se le quitan metadatos sin recomprimirlo.
    // Lanza 415/422/413 si no es una imagen admitida o si no se puede leer.
    const data = toJpeg(raw);
    if (raw.byteLength < MIN_UPLOADED_COVER_BYTES) {
      throw new ApiError(422, "El archivo pesa menos de 1 KB: sube una portada más grande.");
    }
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

    // La versión en la URL es lo que separa una portada nueva de la vieja en
    // todas las cachés por las que pasa: el navegador, la del optimizador de
    // Next y cualquier proxy. Sin ella, una imagen sustituida seguiría viéndose
    // hasta que caducara la copia.
    const coverUrl = `/api/cover/book/${bookId}?v=${Math.floor(Date.now() / 1000).toString(36)}`;
    setBookCoverUrl(bookId, coverUrl);
    invalidatePublicData();
    return json({ coverUrl });
  },
);

/** Quita la portada subida y deja la ficha sin imagen hasta que se suba otra. */
export const DELETE = route<undefined, "user", { bookId: string }>(
  { limit: { bucket: "cover:upload", limit: 20, windowMs: 24 * 60 * 60 * 1000 } },
  ({ params, user }) => {
    const { bookId } = params;

    if (!bookExists(bookId)) throw new ApiError(404, "Esa obra no existe.");
    if (!canManageBookCover(bookId, user.id, user.isAdmin)) {
      throw new ApiError(403, "Solo quien publica el libro puede cambiar su portada.");
    }

    removeUploadedCover(bookId);
    resetBookCover(bookId);
    invalidatePublicData();
    return json({ coverUrl: null });
  },
);
