/**
 * Contrato de `/api/cover/book/[bookId]`.
 *
 * La portada es el objeto más pesado que sirve la aplicación, así que lo que se
 * fija aquí no es solo el contenido: el tamaño se anuncia antes de enviar la
 * imagen, el «no ha cambiado» se resuelve sin abrirla y una ruta inventada no
 * puede salirse de la carpeta de portadas.
 */
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import jpeg from "jpeg-js";
import { toJpeg } from "../src/lib/cover-convert.ts";
import { uploadedCoverResponse } from "../src/lib/cover-response.ts";
import {
  readUploadedCover,
  saveUploadedCover,
  statUploadedCover,
  uploadedCoverType,
} from "../src/lib/covers.ts";

/** JPG válido con metadatos de prueba, como una foto que sale de una cámara. */
const pixels = Buffer.alloc(120 * 180 * 4);
for (let index = 0; index < pixels.length; index += 4) {
  pixels[index] = (index * 7) % 256;
  pixels[index + 1] = (index * 13) % 256;
  pixels[index + 2] = (index * 29) % 256;
  pixels[index + 3] = 255;
}
const cleanJpeg = Buffer.from(jpeg.encode({ data: pixels, width: 120, height: 180 }, 90).data);
const exif = Buffer.from("Exif\0\0GPS coordinates");
const segment = Buffer.alloc(4);
segment[0] = 0xff;
segment[1] = 0xe1;
segment.writeUInt16BE(exif.length + 2, 2);
const JPEG = Buffer.concat([cleanJpeg.subarray(0, 2), segment, exif, cleanJpeg.subarray(2)]);

let dir: string;
const saved = process.env.WANDERBIBLIOTHEK_COVER_CACHE;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wb-cover-route-"));
  process.env.WANDERBIBLIOTHEK_COVER_CACHE = dir;
  writeFileSync(path.join(dir, "upload-bok_route.img"), JPEG);
});

after(() => {
  if (saved === undefined) delete process.env.WANDERBIBLIOTHEK_COVER_CACHE;
  else process.env.WANDERBIBLIOTHEK_COVER_CACHE = saved;
  rmSync(dir, { recursive: true, force: true });
});

function call(bookId: string, headers?: Record<string, string>) {
  return uploadedCoverResponse(
    bookId,
    new Request(`http://localhost/api/cover/book/${bookId}`, { headers }),
  );
}

test("retira los metadatos de portadas antiguas antes de servirlas", async () => {
  const response = await call("bok_route");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("cache-control"), "public, max-age=86400, must-revalidate");

  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.length < JPEG.length, "el segmento EXIF se elimina del fichero");
  assert.equal(body.includes("GPS coordinates"), false);
  assert.deepEqual(jpeg.decode(body, { useTArray: true }).width, 120);
  assert.equal(jpeg.decode(body, { useTArray: true }).height, 180);
});

test("no rechaza una portada válida que queda bajo 1 KB al retirar sus metadatos", () => {
  const smallJpeg = Buffer.from(
    jpeg.encode({ data: Buffer.alloc(4 * 4 * 4), width: 4, height: 4 }, 90).data,
  );
  const privateMetadata = Buffer.alloc(800, 0x41);
  const metadataSegment = Buffer.alloc(4);
  metadataSegment[0] = 0xff;
  metadataSegment[1] = 0xe1;
  metadataSegment.writeUInt16BE(privateMetadata.length + 2, 2);
  const raw = Buffer.concat([
    smallJpeg.subarray(0, 2),
    metadataSegment,
    privateMetadata,
    smallJpeg.subarray(2),
  ]);
  assert.ok(raw.byteLength >= 1_000);

  const sanitized = toJpeg(raw);
  assert.ok(sanitized.byteLength < 1_000);
  assert.ok(saveUploadedCover("bok_small", sanitized));
  assert.equal(readUploadedCover("bok_small")?.data.byteLength, sanitized.byteLength);
});

test("guardar una portada reemplaza un enlace simbólico sin modificar su destino", () => {
  const victimDir = mkdtempSync(path.join(tmpdir(), "wb-cover-victim-"));
  const victim = path.join(victimDir, "victim.img");
  const link = path.join(dir, "upload-bok_link.img");
  const original = Buffer.from("contenido que no debe sobrescribirse");
  writeFileSync(victim, original);

  try {
    symlinkSync(victim, link);
    const saved = saveUploadedCover("bok_link", JPEG);

    assert.ok(saved);
    assert.deepEqual(readFileSync(victim), original);
    assert.equal(lstatSync(link).isSymbolicLink(), false);
    assert.deepEqual(readFileSync(link), saved.data);
  } finally {
    rmSync(victimDir, { recursive: true, force: true });
  }
});

test("un validador que coincide responde 304 sin cuerpo", async () => {
  const etag = (await call("bok_route")).headers.get("etag");
  assert.ok(etag);

  const second = await call("bok_route", { "if-none-match": etag });
  assert.equal(second.status, 304);
  assert.equal(second.headers.get("etag"), etag);
  assert.equal((await second.arrayBuffer()).byteLength, 0);
});

test("el validador se compara en débil y admite una lista", async () => {
  const etag = (await call("bok_route")).headers.get("etag");
  assert.ok(etag);

  // Un proxy puede reescribirlo como débil o mandar varios separados por comas.
  for (const header of [`W/${etag}`, `"otro", ${etag}`, "*"]) {
    const response = await call("bok_route", { "if-none-match": header });
    assert.equal(response.status, 304, header);
  }

  const other = await call("bok_route", { "if-none-match": '"otro"' });
  assert.equal(other.status, 200);
});

test("también valida por fecha, para quien no manda ETag", async () => {
  const lastModified = (await call("bok_route")).headers.get("last-modified");
  assert.ok(lastModified);

  const second = await call("bok_route", { "if-modified-since": lastModified });
  assert.equal(second.status, 304);
});

test("una portada que no existe responde 404 con caché corta", async () => {
  const response = await call("bok_missing");

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
});

test("un identificador que no es un id de obra no toca el disco", async () => {
  for (const bookId of ["../etc/passwd", "bok_1/../../x", ""]) {
    const response = await call(bookId);
    assert.equal(response.status, 404, bookId);
  }
});

test("un fichero por debajo del mínimo no cuenta como portada", () => {
  writeFileSync(path.join(dir, "upload-bok_tiny.img"), Buffer.from([0xff, 0xd8, 0xff]));

  assert.equal(statUploadedCover("bok_tiny"), null);
});

test("el tipo se resuelve con la cabecera, no leyendo la imagen", () => {
  assert.equal(uploadedCoverType(path.join(dir, "upload-bok_route.img")), "image/jpeg");
  assert.equal(uploadedCoverType(path.join(dir, "no-existe.img")), null);
});

/**
 * La tarjeta pedía el JPG entero (1600 px, hasta 4 MB) para un hueco de 220 px:
 * esa era la carga de la portada con varias visitas. Marcar `unoptimized` lo
 * devuelve tal cual, así que se vigila que nadie lo reponga sin querer.
 */
test("la tarjeta deja que el optimizador reduzca la portada", () => {
  const source = readFileSync(
    new URL("../src/components/book-cover.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /unoptimized/);
});
