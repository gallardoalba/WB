import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, test } from "node:test";

import jpeg from "jpeg-js";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type CoversModule = typeof import("../src/lib/covers.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let covers: CoversModule;
let repo: RepoModule;

before(async () => {
  covers = await import("../src/lib/covers.ts");
  repo = await import("../src/lib/repo.ts");
});

/** PNG de mentira: solo importan la firma y el tamaño mínimo. */
function pngDe(bytes: number): Buffer {
  const buffer = Buffer.alloc(bytes, 0x20);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  return buffer;
}

/** JPG válido con metadatos de relleno para superar el mínimo de subida. */
function jpegDe(): Buffer {
  const clean = Buffer.from(
    jpeg.encode({ data: Buffer.alloc(8 * 8 * 4), width: 8, height: 8 }, 90).data,
  );
  const payload = Buffer.alloc(2_000 - clean.byteLength - 4, 0x20);
  const segment = Buffer.alloc(4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(payload.byteLength + 2, 2);
  return Buffer.concat([clean.subarray(0, 2), segment, payload, clean.subarray(2)]);
}

function cacheNueva(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-covers-"));
  process.env.WANDERBIBLIOTHEK_COVER_CACHE = dir;
  return dir;
}

test("una portada subida se guarda y se lee como imagen", () => {
  const dir = cacheNueva();
  assert.equal(covers.saveUploadedCover("../../etc", jpegDe()), null, "id raro");
  assert.equal(covers.saveUploadedCover("bok_1", Buffer.from("no soy una imagen")), null);
  // Solo JPG: un PNG con firma válida tampoco entra (lo dice la interfaz y lo
  // vuelve a comprobar el servidor por los primeros bytes).
  assert.equal(covers.saveUploadedCover("bok_1", pngDe(2_000)), null, "solo JPG");

  const saved = covers.saveUploadedCover("bok_1", jpegDe());
  assert.equal(saved?.contentType, "image/jpeg");
  assert.ok(saved && saved.data.length < 2_000, "se eliminan los metadatos");
  assert.deepEqual(readdirSync(dir), ["upload-bok_1.img"]);

  const read = covers.readUploadedCover("bok_1");
  assert.equal(read?.contentType, "image/jpeg");
  assert.deepEqual(read?.data, saved?.data);

  covers.removeUploadedCover("bok_1");
  assert.equal(covers.readUploadedCover("bok_1"), null);
});

test("la limpieza de la caché no borra las portadas subidas", () => {
  const dir = cacheNueva();
  covers.saveUploadedCover("bok_2", jpegDe());
  // Una portada cacheada y una marca de ausencia antiguas.
  writeFileSync(path.join(dir, "9788420412146.img"), pngDe(2_000));
  writeFileSync(path.join(dir, "9788420412146.miss"), "");
  const old = new Date("2020-01-01T00:00:00Z");
  for (const file of ["9788420412146.img", "9788420412146.miss", "upload-bok_2.img"]) {
    const full = path.join(dir, file);
    // `pruneCoverCache` mira el `mtime`: se envejecen los tres por igual.
    utimesSync(full, old, old);
  }

  covers.pruneCoverCache(180);
  assert.deepEqual(readdirSync(dir), ["upload-bok_2.img"], "la subida se queda");
});

test("la portada solo la cambia quien publica el ejemplar", () => {
  // Clara publica lst_1 (bok_1); Diego no publica nada de esa obra.
  assert.equal(repo.canManageBookCover("bok_1", "usr_clara"), true);
  assert.equal(repo.canManageBookCover("bok_1", "usr_diego"), false);
  // La administración puede corregir una portada equivocada.
  assert.equal(repo.canManageBookCover("bok_1", "usr_admin", true), true);
});
