/**
 * Preparar una portada antes de subirla.
 *
 * Las fotos salen del móvil con 3000-4000 px de lado y 5-10 MB, y el servidor
 * solo acepta JPG de como mucho 4 MB. En vez de rechazarlas, aquí se reducen y
 * se recomprimen en el navegador hasta cumplir; si la imagen ya cumple, se
 * sube tal cual, porque recomprimir sin necesidad solo pierde calidad.
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

/**
 * Devuelve un JPG que el servidor acepta: `file` si ya cumplía, o una versión
 * reducida. Lanza si el navegador no puede decodificar el archivo.
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
    if (alreadyFits) return file;

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
