/**
 * De PNG a JPG en el servidor.
 *
 * El navegador ya reduce y recomprime la portada antes de subirla (ver
 * `cover-image.ts`), pero eso no puede ser la única garantía: la app Android y
 * cualquier cliente que hable con la API también suben imágenes, y quien llama a
 * la API no tiene por qué saber que la política de la casa es JPG. Aquí se
 * acepta un PNG y se guarda un JPG, con el decodificador y el codificador en
 * JavaScript puro (`pngjs` y `jpeg-js`): ni `sharp` ni binarios nativos en un
 * servidor pequeño.
 *
 * Lo que llega es contenido de terceros, así que antes de decodificar se leen
 * las dimensiones de la cabecera: un PNG de 4 MB puede declarar 20 000 × 20 000
 * y tumbar el proceso al reservar la imagen en memoria. Se corta por lado y por
 * número de píxeles.
 */
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { ApiError } from "./errors";

/**
 * Lado máximo: una portada que pasa de aquí es una tira absurda (100 × 20 000)
 * o un error de escaneo, no una imagen que alguien quiera ver en el catálogo.
 * El tope de memoria lo pone `MAX_COVER_PIXELS`, que es el que manda en las
 * imágenes cuadradas o apaisadas.
 */
export const MAX_COVER_SIDE = 8_000;
/** Tope de píxeles: 16 Mpx son 64 MB en RGBA, lo máximo razonable aquí. */
export const MAX_COVER_PIXELS = 16_000_000;
/** Calidad del JPG resultante: 85 es el punto habitual entre peso y detalle. */
const QUALITY = 85;

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isJpeg(data: Buffer): boolean {
  return data.length >= 3 && JPEG_MAGIC.every((byte, index) => data[index] === byte);
}

export function isPng(data: Buffer): boolean {
  return (
    data.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => data[index] === byte)
  );
}

/**
 * Ancho y alto declarados en la cabecera IHDR (bytes 16 a 24, big-endian).
 * Se leen sin decodificar la imagen: es lo que permite rechazar bombas.
 */
function declaredPngSize(data: Buffer): { width: number; height: number } | null {
  if (!isPng(data) || data.length < 24) return null;
  if (data.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Aplana la transparencia sobre blanco: un JPG no tiene canal alfa. */
function flattenOnWhite(pixels: Buffer): Buffer {
  const out = Buffer.allocUnsafe(pixels.length);
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]!;
    if (alpha === 255) {
      out[index] = pixels[index]!;
      out[index + 1] = pixels[index + 1]!;
      out[index + 2] = pixels[index + 2]!;
    } else {
      // Mezcla con el fondo blanco: 255·(1-a) + color·a
      const pintar = alpha / 255;
      const fondo = 255 * (1 - pintar);
      out[index] = Math.round(pixels[index]! * pintar + fondo);
      out[index + 1] = Math.round(pixels[index + 1]! * pintar + fondo);
      out[index + 2] = Math.round(pixels[index + 2]! * pintar + fondo);
    }
    out[index + 3] = 255;
  }
  return out;
}

/**
 * Devuelve siempre un JPG: el mismo si ya lo era, o el PNG convertido.
 * Lanza `ApiError` —en el idioma de la aplicación— cuando no hay nada que hacer.
 */
export function toJpeg(data: Buffer): Buffer {
  if (isJpeg(data)) return data;
  if (!isPng(data)) {
    throw new ApiError(415, "La portada tiene que ser un JPG o un PNG.");
  }

  const size = declaredPngSize(data);
  if (!size || size.width === 0 || size.height === 0) {
    throw new ApiError(422, "El PNG está dañado y no se puede leer.");
  }
  if (size.width > MAX_COVER_SIDE || size.height > MAX_COVER_SIDE) {
    throw new ApiError(
      413,
      `La imagen mide ${size.width}×${size.height}: el máximo es ${MAX_COVER_SIDE} px de lado.`,
    );
  }
  if (size.width * size.height > MAX_COVER_PIXELS) {
    throw new ApiError(413, "La imagen tiene demasiados píxeles: redúcela antes de subirla.");
  }

  let png: PNG;
  try {
    png = PNG.sync.read(data);
  } catch {
    throw new ApiError(422, "El PNG está dañado y no se puede convertir a JPG.");
  }

  const encoded = jpeg.encode(
    { data: flattenOnWhite(png.data), width: png.width, height: png.height },
    QUALITY,
  );
  return Buffer.from(encoded.data);
}
