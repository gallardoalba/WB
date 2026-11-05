import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, test } from "node:test";

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

function cacheNueva(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-covers-"));
  process.env.WANDERBIBLIOTHEK_COVER_CACHE = dir;
  return dir;
}

test("Google Books vale como segunda fuente, pero solo con nuestro ISBN", () => {
  const conNuestroIsbn = {
    items: [
      {
        volumeInfo: {
          industryIdentifiers: [{ type: "ISBN_13", identifier: "978-3-406-85338-8" }],
          imageLinks: { thumbnail: "http://books.google.com/books/content?id=x&zoom=1&edge=curl" },
        },
      },
    ],
  };
  assert.equal(
    covers.googleBooksCoverUrl(conNuestroIsbn, "9783406853388"),
    "https://books.google.com/books/content?id=x&zoom=2",
  );

  // Otra edición (ISBN distinto): no sirve, sería la portada de otro libro.
  const otraEdicion = {
    items: [
      {
        volumeInfo: {
          industryIdentifiers: [{ type: "ISBN_13", identifier: "9780000000000" }],
          imageLinks: { thumbnail: "http://books.google.com/x&zoom=1" },
        },
      },
    ],
  };
  assert.equal(covers.googleBooksCoverUrl(otraEdicion, "9783406853388"), null);
  assert.equal(covers.googleBooksCoverUrl({}, "9783406853388"), null);
  assert.equal(covers.googleBooksCoverUrl(null, "9783406853388"), null);
});

test("la búsqueda por obra usa la primera portada que aparece", async () => {
  assert.equal(await covers.openLibraryWorkCoverId({ docs: [{ cover_i: 0 }, { cover_i: 83 }] }), 83);
  assert.equal(await covers.openLibraryWorkCoverId({ docs: [] }), null);
  assert.equal(await covers.openLibraryWorkCoverId({}), null);
});

test("la búsqueda por título no acepta cualquier libro", () => {
  assert.equal(
    covers.titlesMatch("Die Antiquiertheit des Menschen I", "Die Antiquiertheit des Menschen. Erster Band"),
    true,
  );
  assert.equal(covers.titlesMatch("Der eindimensionale Mensch", "Eros and Civilization"), false);
  assert.equal(covers.authorMatches("Herbert Marcuse", ["Marcuse, Herbert"]), true);
  assert.equal(covers.authorMatches("Herbert Marcuse", ["Günther Anders"]), false);
});

test("se prefiere la portada de la edición propia; si no la hay, la de la obra", () => {
  // La edición alemana no tiene portada y la inglesa sí: se usa la inglesa.
  const sinPortadaPropia = {
    docs: [
      { cover_i: 5290889, title: "One-Dimensional Man", author_name: ["Herbert Marcuse"] },
      { title: "Der eindimensionale Mensch", author_name: ["Herbert Marcuse"] },
    ],
  };
  assert.equal(
    covers.pickWorkCover(sinPortadaPropia, "Der eindimensionale Mensch", "Herbert Marcuse"),
    5290889,
  );

  // Si la edición propia tiene portada, gana esa aunque aparezca más abajo.
  const conPortadaPropia = {
    docs: [
      { cover_i: 111, title: "One-Dimensional Man", author_name: ["Herbert Marcuse"] },
      { cover_i: 222, title: "Der eindimensionale Mensch", author_name: ["Herbert Marcuse"] },
    ],
  };
  assert.equal(
    covers.pickWorkCover(conPortadaPropia, "Der eindimensionale Mensch", "Herbert Marcuse"),
    222,
  );

  // Otra autoría no vale, por mucho que la búsqueda la haya devuelto.
  const otroAutor = {
    docs: [{ cover_i: 999, title: "Libro inventado", author_name: ["Otra Persona"] }],
  };
  assert.equal(covers.pickWorkCover(otroAutor, "Libro inventado", "Nadie"), null);
  // Sin autoría no se acepta una edición con otro título.
  assert.equal(covers.pickWorkCover(sinPortadaPropia, "Der eindimensionale Mensch", ""), null);
});

test("el ISBN-10 se convierte al 13 para consultar las portadas", () => {
  assert.equal(covers.toIsbn13("3548028462"), "9783548028460");
  assert.equal(covers.toIsbn13("9783866742390"), "9783866742390");
  assert.equal(covers.toIsbn13("12345"), null);
});

test("el título se prueba entero, sin volumen y sin subtítulo", () => {
  assert.deepEqual(covers.titleVariants("Die Antiquiertheit des Menschen I"), [
    "Die Antiquiertheit des Menschen I",
    "Die Antiquiertheit des Menschen",
  ]);
  assert.deepEqual(
    covers.titleVariants("Staatlichkeit und Anarchie und andere Schriften"),
    ["Staatlichkeit und Anarchie und andere Schriften", "Staatlichkeit und Anarchie"],
  );
  assert.deepEqual(covers.titleVariants("Der eindimensionale Mensch"), [
    "Der eindimensionale Mensch",
  ]);
  assert.deepEqual(covers.titleVariants("   "), []);
});

test("una portada subida se guarda y se lee como imagen", () => {
  const dir = cacheNueva();
  assert.equal(covers.saveUploadedCover("../../etc", pngDe(2_000)), null, "id raro");
  assert.equal(covers.saveUploadedCover("bok_1", Buffer.from("no soy una imagen")), null);

  const saved = covers.saveUploadedCover("bok_1", pngDe(2_000));
  assert.equal(saved?.contentType, "image/png");
  assert.deepEqual(readdirSync(dir), ["upload-bok_1.img"]);

  const read = covers.readUploadedCover("bok_1");
  assert.equal(read?.contentType, "image/png");
  assert.equal(read?.data.length, 2_000);

  covers.removeUploadedCover("bok_1");
  assert.equal(covers.readUploadedCover("bok_1"), null);
});

test("la limpieza de la caché no borra las portadas subidas", () => {
  const dir = cacheNueva();
  covers.saveUploadedCover("bok_2", pngDe(2_000));
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

test("quitar la portada devuelve la búsqueda por ISBN", () => {
  repo.setBookCoverUrl("bok_1", "/api/cover/book/bok_1");
  assert.equal(repo.getListing("lst_1", null)?.coverUrl, "/api/cover/book/bok_1");

  repo.resetBookCover("bok_1");
  assert.equal(repo.getListing("lst_1", null)?.coverUrl, "/api/cover/9783866742390");
});
