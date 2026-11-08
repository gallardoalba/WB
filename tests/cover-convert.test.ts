import assert from "node:assert/strict";
import { test } from "node:test";

import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { MAX_COVER_PIXELS, MAX_COVER_SIDE, isJpeg, isPng, toJpeg } from "../src/lib/cover-convert.ts";
import { ApiError } from "../src/lib/errors.ts";

/** PNG cuadrado de un solo color, con alfa opcional. */
function makePng(
  width: number,
  height: number,
  color: [number, number, number, number] = [200, 30, 40, 255],
): Buffer {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = color[0];
    png.data[index + 1] = color[1];
    png.data[index + 2] = color[2];
    png.data[index + 3] = color[3];
  }
  return PNG.sync.write(png);
}

/** Cabecera PNG con dimensiones inventadas, sin datos de imagen detrás. */
function fakePngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8; // profundidad de bits
  header[25] = 6; // RGBA
  return header;
}

function expectApiError(status: number, action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ApiError, `se esperaba ApiError y llegó ${String(error)}`);
    assert.equal(error.status, status);
    return true;
  });
}

test("isJpeg e isPng miran los primeros bytes, no el nombre del archivo", () => {
  assert.equal(isJpeg(jpeg.encode({ data: Buffer.alloc(16), width: 2, height: 2 }, 80).data), true);
  assert.equal(isPng(makePng(2, 2)), true);
  assert.equal(isPng(Buffer.from("GIF89a")), false);
  assert.equal(isJpeg(Buffer.from("PNG")), false);
});

test("un JPG se devuelve tal cual, sin recomprimir", () => {
  const original = Buffer.from(jpeg.encode({ data: Buffer.alloc(4 * 4 * 4), width: 4, height: 4 }, 90).data);
  const result = toJpeg(original);
  assert.equal(result, original, "debe ser el mismo objeto, no una copia recodificada");
});

test("un PNG se convierte en JPG conservando el tamaño", () => {
  const png = makePng(6, 4);
  const result = toJpeg(png);
  assert.equal(isJpeg(result), true, "el resultado tiene que empezar por FF D8 FF");
  const decoded = jpeg.decode(result, { useTArray: true });
  assert.equal(decoded.width, 6);
  assert.equal(decoded.height, 4);
  // El rojo del original sobrevive a la recompresión.
  assert.ok(decoded.data[0]! > 150, `rojo esperado, llegó ${decoded.data[0]}`);
  assert.ok(decoded.data[1]! < 90, `verde bajo esperado, llegó ${decoded.data[1]}`);
});

test("la transparencia de un PNG se aplana sobre blanco", () => {
  const result = toJpeg(makePng(4, 4, [0, 0, 0, 0]));
  const decoded = jpeg.decode(result, { useTArray: true });
  for (let index = 0; index < decoded.data.length; index += 4) {
    assert.ok(
      decoded.data[index]! > 240,
      `un píxel transparente tiene que salir blanco y salió ${decoded.data[index]}`,
    );
  }
});

test("un PNG opaco no se altera al aplanarlo", () => {
  const decoded = jpeg.decode(toJpeg(makePng(4, 4, [10, 200, 30, 255])), { useTArray: true });
  assert.ok(decoded.data[0]! < 60, `rojo bajo esperado, llegó ${decoded.data[0]}`);
  assert.ok(decoded.data[1]! > 170, `verde alto esperado, llegó ${decoded.data[1]}`);
});

test("una portada real de PNG sale con un tamaño que el almacén acepta", () => {
  // `saveUploadedCover` rechaza por debajo de 1 KB, y el lector de la caché
  // también: si la conversión dejara un archivo minúsculo, el libro se quedaría
  // sin portada sin que nadie supiera por qué. Se prueba con ruido, que es el
  // peor caso para el JPG (poco compresible).
  const png = new PNG({ width: 300, height: 450 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = (index * 7) % 256;
    png.data[index + 1] = (index * 13) % 256;
    png.data[index + 2] = (index * 29) % 256;
    png.data[index + 3] = 255;
  }
  const result = toJpeg(PNG.sync.write(png));
  assert.equal(isJpeg(result), true);
  assert.ok(result.byteLength > 1_000, `solo ${result.byteLength} bytes: por debajo del mínimo`);
  assert.ok(result.byteLength < 4 * 1024 * 1024, `${result.byteLength} bytes: pasa del máximo`);
});

test("lo que no es ni JPG ni PNG se rechaza con 415", () => {
  expectApiError(415, () => toJpeg(Buffer.from("GIF89a...............")));
  expectApiError(415, () => toJpeg(Buffer.from("RIFF....WEBPVP8 ")));
  expectApiError(415, () => toJpeg(Buffer.from("no soy una imagen")));
  expectApiError(415, () => toJpeg(Buffer.alloc(0)));
});

test("una cabecera PNG con dimensiones enormes se rechaza antes de decodificar", () => {
  // Sin los bytes de imagen detrás: si se intentara decodificar, esto fallaría
  // con 422 en vez de con 413. El 413 demuestra que se corta por la cabecera.
  expectApiError(413, () => toJpeg(fakePngHeader(MAX_COVER_SIDE + 1, 100)));
  expectApiError(413, () => toJpeg(fakePngHeader(100, MAX_COVER_SIDE + 1)));
});

test("una cabecera PNG con demasiados píxeles se rechaza aunque cada lado valga", () => {
  const side = Math.floor(Math.sqrt(MAX_COVER_PIXELS)) + 10;
  assert.ok(side <= MAX_COVER_SIDE, "el caso solo tiene sentido si el lado está permitido");
  expectApiError(413, () => toJpeg(fakePngHeader(side, side)));
});

test("una cabecera PNG vacía o sin IHDR se rechaza con 422", () => {
  expectApiError(422, () => toJpeg(fakePngHeader(0, 0)));
  const sinIhdr = fakePngHeader(10, 10);
  sinIhdr.write("IHDR", 12, "latin1");
  sinIhdr.write("IDAT", 12, "latin1");
  expectApiError(422, () => toJpeg(sinIhdr));
  expectApiError(422, () => toJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
});

test("un PNG truncado se rechaza con 422 y no revienta", () => {
  const png = makePng(40, 40);
  expectApiError(422, () => toJpeg(png.subarray(0, 40)));
});

test("un PNG con la firma correcta pero el cuerpo corrupto se rechaza con 422", () => {
  const png = makePng(20, 20);
  const broken = Buffer.from(png);
  // Zona de datos de imagen (IDAT): se rompe la cabecera zlib para que
  // `PNG.sync.read` no pueda inflar el flujo.
  for (let index = 50; index < Math.min(broken.length, 80); index += 1) broken[index] = 0xff;
  expectApiError(422, () => toJpeg(broken));
});
