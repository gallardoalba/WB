/**
 * Preparar una portada antes de subirla.
 *
 * Las fotos salen del móvil con 3000-4000 px de lado y 5-10 MB, y el servidor
 * solo acepta JPG de como mucho 4 MB. En vez de rechazarlas, aquí se reducen y
 * se recomprimen en el navegador hasta cumplir; si la imagen ya cumple, se
 * sube tal cual para conservar la calidad; el servidor retira los metadatos
 * del archivo sin recomprimir sus píxeles.
 *
 * La aritmética del tamaño (`coverSize`) vive aparte, sin DOM, para poder
 * probarla en Node.
 */

/** Lo mismo que acepta `saveUploadedCover` en el servidor. */
export const MAX_COVER_BYTES = 4 * 1024 * 1024;
/** Lado mayor de la portada. A 1600 px una cubierta se ve nítida en pantalla. */
export const MAX_COVER_SIDE = 1600;
/** Por encima de esto ni se intenta: bloquearía el navegador sin avisar. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export type CoverSize = { width: number; height: number };

/** Tamaño final sin deformar y sin ampliar nunca una imagen pequeña. */
export function coverSize(width: number, height: number, maxSide = MAX_COVER_SIDE): CoverSize {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return { width: 0, height: 0 };
  if (longest <= maxSide) return { width: Math.round(width), height: Math.round(height) };
  const factor = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/** Lo mínimo para dibujar: sirve un `ImageBitmap` y también un `<img>`. */
type Source = ImageBitmap | HTMLImageElement;

async function open(file: File): Promise<{ source: Source; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // `from-image` respeta la orientación EXIF de las fotos de móvil: sin
      // esto, media colección saldría tumbada.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, close: () => bitmap.close() };
    } catch {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, close: () => bitmap.close() };
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { source: image, close: () => URL.revokeObjectURL(url) };
}

async function rasterize(source: Source, size: CoverSize, quality: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, size.width, size.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

function needsExifOrientationNormalization(data: Uint8Array): boolean {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return false;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const read16 = (offset: number, littleEndian: boolean, limit = data.length): number | null =>
    offset >= 0 && offset + 2 <= limit ? view.getUint16(offset, littleEndian) : null;
  const read32 = (offset: number, littleEndian: boolean, limit = data.length): number | null =>
    offset >= 0 && offset + 4 <= limit ? view.getUint32(offset, littleEndian) : null;

  let offset = 2;
  while (offset < data.length) {
    if (data[offset] !== 0xff) return false;
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    if (offset >= data.length) return false;

    const marker = data[offset]!;
    offset += 1;
    if (marker === 0xda || marker === 0xd9) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0x00) return false;

    const segmentLength = read16(offset, false);
    if (segmentLength === null || segmentLength < 2) return false;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > data.length) return false;

    const payload = offset + 2;
    if (
      marker === 0xe1 &&
      segmentLength >= 8 &&
      data[payload] === 0x45 &&
      data[payload + 1] === 0x78 &&
      data[payload + 2] === 0x69 &&
      data[payload + 3] === 0x66 &&
      data[payload + 4] === 0 &&
      data[payload + 5] === 0
    ) {
      const tiff = payload + 6;
      const littleEndian = data[tiff] === 0x49 && data[tiff + 1] === 0x49;
      const bigEndian = data[tiff] === 0x4d && data[tiff + 1] === 0x4d;
      if ((!littleEndian && !bigEndian) || tiff + 8 > segmentEnd) return true;
      if (read16(tiff + 2, littleEndian, segmentEnd) !== 42) return true;

      const ifdOffset = read32(tiff + 4, littleEndian, segmentEnd);
      if (ifdOffset === null) return true;
      const ifd = tiff + ifdOffset;
      if (ifd < tiff + 8) return true;
      const entries = read16(ifd, littleEndian, segmentEnd);
      if (entries === null || ifd + 2 + entries * 12 + 4 > segmentEnd) return true;

      for (let index = 0; index < entries; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (read16(entry, littleEndian, segmentEnd) !== 0x0112) continue;
        if (read16(entry + 2, littleEndian, segmentEnd) !== 3) return true;
        const count = read32(entry + 4, littleEndian, segmentEnd);
        if (count !== 1) return true;
        const orientation = read16(entry + 8, littleEndian, segmentEnd);
        return orientation === null || orientation !== 1;
      }
      return false;
    }

    offset = segmentEnd;
  }
  return false;
}

/**
 * Devuelve un JPG que el servidor acepta: `file` si ya cumplía, o una versión
 * reducida o con la orientación aplicada a los píxeles. Lanza si el navegador
 * no puede decodificar el archivo.
 */
export async function prepareCover(file: File): Promise<Blob> {
  const { source, close } = await open(file);
  try {
    const size = coverSize(source.width, source.height);
    const alreadyFits =
      size.width === source.width &&
      size.height === source.height &&
      file.size <= MAX_COVER_BYTES &&
      file.type === "image/jpeg";
    if (
      alreadyFits &&
      !needsExifOrientationNormalization(new Uint8Array(await file.arrayBuffer()))
    ) {
      return file;
    }

    let maxSide = MAX_COVER_SIDE;
    let quality = 0.85;
    let last: Blob | null = null;

    // Como mucho ocho intentos: baja calidad y, si aun así no cabe, tamaño.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const target = coverSize(source.width, source.height, maxSide);
      const blob = await rasterize(source, target, quality);
      if (!blob) throw new Error("No se pudo procesar la imagen.");
      last = blob;
      if (blob.size <= MAX_COVER_BYTES) return blob;
      if (quality > 0.6) quality = Math.max(0.5, quality - 0.15);
      else maxSide = Math.max(400, Math.round(maxSide * 0.75));
    }

    return last ?? file;
  } finally {
    close();
  }
}
