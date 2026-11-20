/**
 * De PNG a JPG en el servidor.
 *
 * El navegador ya reduce y recomprime la portada antes de subirla (ver
 * `cover-image.ts`), pero eso no puede ser la única garantía: cualquier cliente
 * que hable con la API también puede subir imágenes directamente. Aquí se
 * convierte PNG a JPG y se eliminan los segmentos de metadatos de los JPG sin
 * recomprimir sus píxeles, usando JavaScript puro (`pngjs` y `jpeg-js`).
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
export const MAX_COVER_SIDE = 6_000;
/** Tope de píxeles: 8 Mpx son 32 MB en RGBA; el decodificado es síncrono. */
export const MAX_COVER_PIXELS = 8_000_000;
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

/**
 * Elimina segmentos de aplicación/comentario de un JPEG y conserva su flujo de
 * imagen. Se mantienen APP14 (Adobe), necesario para interpretar ciertos JPEG
 * CMYK; los demás APP pueden contener EXIF/GPS, XMP, IPTC, miniaturas o datos
 * privados. También se procesa JPEG progresivo, que puede intercalar segmentos
 * entre sus distintos barridos.
 */
export function stripJpegMetadata(data: Buffer): Buffer {
  const invalid = () => new ApiError(422, "El JPEG está dañado y no se puede limpiar.");
  if (!isJpeg(data) || data[1] !== 0xd8) throw invalid();

  const chunks: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;
  let changed = false;
  let sawEnd = false;

  while (offset < data.length) {
    const markerStart = offset;
    if (data[offset] !== 0xff) throw invalid();
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    if (offset >= data.length) throw invalid();

    const marker = data[offset]!;
    offset += 1;
    if (marker === 0x00 || marker === 0xd8) throw invalid();

    if (marker === 0xd9) {
      chunks.push(data.subarray(markerStart, offset));
      sawEnd = true;
      if (offset < data.length) changed = true;
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(data.subarray(markerStart, offset));
      continue;
    }

    if (offset + 2 > data.length) throw invalid();
    const segmentLength = data.readUInt16BE(offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > data.length) throw invalid();

    const isMetadata =
      (marker >= 0xe0 && marker <= 0xed) || marker === 0xef || marker === 0xfe;
    if (isMetadata) changed = true;
    else chunks.push(data.subarray(markerStart, segmentEnd));
    offset = segmentEnd;

    if (marker !== 0xda) continue;

    const scanStart = offset;
    let nextMarkerFound = false;
    while (offset < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const candidateStart = offset;
      offset += 1;
      while (offset < data.length && data[offset] === 0xff) offset += 1;
      if (offset >= data.length) throw invalid();

      const code = data[offset]!;
      if (code === 0x00 || (code >= 0xd0 && code <= 0xd7)) {
        offset += 1;
        continue;
      }

      chunks.push(data.subarray(scanStart, candidateStart));
      offset = candidateStart;
      nextMarkerFound = true;
      break;
    }

    if (!nextMarkerFound) {
      chunks.push(data.subarray(scanStart));
      break;
    }
  }

  if (!sawEnd) throw invalid();
  return changed ? Buffer.concat(chunks) : data;
}

/**
 * Ancho y alto de una imagen, sin decodificarla entera.
 *
 * Sirve para encajar una portada en una tarjeta sin pagar el decodificado: el
 * JPEG se lee recorriendo sus marcadores hasta el SOF y el PNG en la cabecera
 * IHDR. Devuelve `null` si el formato no se reconoce.
 */
export function imageDimensions(data: Buffer): { width: number; height: number } | null {
  if (isPng(data)) return declaredPngSize(data);
  if (!isJpeg(data)) return null;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1]!;
    // Los marcadores SOF (menos DHT, JPG y DAC) llevan las dimensiones.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
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
 * Devuelve siempre un JPG sin metadatos de imagen: el JPG conserva sus píxeles
 * originales y el PNG se convierte a JPG.
 * Lanza `ApiError` —en el idioma de la aplicación— cuando no hay nada que hacer.
 */
export function toJpeg(data: Buffer): Buffer {
  if (isJpeg(data)) return stripJpegMetadata(data);
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
