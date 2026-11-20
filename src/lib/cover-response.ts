/**
 * Respuesta HTTP de una portada subida.
 *
 * Vive fuera de la ruta a propósito: la ruta importa `server-only` (sesión y
 * guardias de origen) y arrastraría Next al probarla. Aquí queda el contrato que
 * importa —tamaño anunciado, validador y 304 sin abrir la imagen— y se puede
 * ejercitar en Node.
 *
 * Coste y motivo: la portada es lo más pesado que sirve la aplicación. Con
 * `readFileSync` cada visita —incluida la que solo pregunta «¿ha cambiado?»—
 * leía hasta 4 MB y los copiaba a memoria; con varias a la vez, el proceso se
 * quedaba atendiendo imágenes en lugar de páginas. Ahora se envía según se lee
 * y el «no ha cambiado» no abre el fichero.
 *
 * El envío va troceado (`chunked`) y no lleva `Content-Length`: Next descarta
 * esa cabecera cuando el cuerpo es un flujo, y anunciarla obligaría a leer la
 * imagen entera antes de responder. Para una portada el tamaño no hace falta
 * (el hueco lo fija el CSS), y por HTTP/2 el troceado no existe.
 */
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { sanitizeUploadedCover, statUploadedCover, uploadedCoverType } from "./covers";

/**
 * `If-None-Match` se compara en débil (RFC 9110): `W/"x"` también vale para
 * `"x"`, y la cabecera puede traer una lista. Un proxy delante reescribe el
 * validador como débil, y sin esto la respuesta sería un 200 con la imagen
 * entera en vez de un 304.
 */
function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  const trimmed = header.trim();
  if (trimmed === "*") return true;
  return trimmed
    .split(",")
    .some((value) => value.trim().replace(/^W\//, "") === etag);
}

export function uploadedCoverResponse(bookId: string, request: Request): Response {
  const existing = statUploadedCover(bookId);
  if (!existing) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  }

  sanitizeUploadedCover(bookId);
  const file = statUploadedCover(bookId);
  if (!file) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  }

  // La imagen cambia solo si quien publica la sustituye, y entonces la URL lleva
  // una versión nueva (`?v=…`). El validador sale del `mtime` y el tamaño, que
  // se leen sin tocar el contenido.
  const mtime = Math.floor(file.mtimeMs / 1000);
  const etag = `"${mtime.toString(36)}-${file.size.toString(36)}"`;
  const headers: Record<string, string> = {
    // Las portadas subidas son siempre JPG (`saveUploadedCover`), pero el tipo
    // se mira en la cabecera por si queda alguna de antes de esa regla.
    "content-type": uploadedCoverType(file.path) ?? "image/jpeg",
    "cache-control": "public, max-age=86400, must-revalidate",
    "x-content-type-options": "nosniff",
    etag,
    "last-modified": new Date(mtime * 1000).toUTCString(),
  };

  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  const since = request.headers.get("if-modified-since");
  if (since && Date.parse(since) >= mtime * 1000) {
    return new Response(null, { status: 304, headers });
  }

  // Se envía según se lee del disco, sin copiar la imagen a memoria: deja de
  // haber un búfer de hasta 4 MB por visitante.
  const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>;
  return new Response(stream, { headers });
}
