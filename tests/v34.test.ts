import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type DbModule = typeof import("../src/lib/db/index.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let dbModule: DbModule;
let repo: RepoModule;

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  repo = await import("../src/lib/repo.ts");
});

/**
 * El ISBN es la identidad de la obra.
 *
 * Al publicar se busca la obra por ISBN y, si ya existe, se reutiliza su ficha
 * (título, autoría, género): quien publica el segundo ejemplar de un libro que
 * ya está en el catálogo no crea una ficha duplicada. El formulario consulta
 * `/api/isbn/<isbn>` para enseñarlo antes de enviar.
 */
const ISBN = "9788417860790";

test("el ISBN identifica la obra: la segunda publicación reutiliza la ficha", () => {
  const first = repo.createListing("usr_ana", {
    title: "El infinito en un junco",
    author: "Irene Vallejo",
    category: "Humanidades",
    condition: "Buen estado",
    isbn: ISBN,
    city: "Stuttgart",
    tags: [],
  });
  const second = repo.createListing("usr_clara", {
    title: "Otro título escrito a mano",
    author: "Otra autoría",
    category: "Ficción",
    condition: "Como nuevo",
    isbn: ISBN,
    city: "Mannheim",
    tags: [],
  });
  assert.notEqual(first.id, second.id, "cada ejemplar es una publicación distinta");
  assert.equal(second.bookId, first.bookId, "la obra es la misma");
  assert.equal(second.title, "El infinito en un junco", "manda la ficha del catálogo");
  assert.equal(second.category, "Humanidades");
  assert.equal(second.city, "Mannheim", "la ciudad sí es de cada ejemplar");
});

test("la consulta por ISBN devuelve la obra para avisar en el formulario", () => {
  const found = repo.bookByIsbn(ISBN);
  assert.ok(found);
  assert.equal(found.title, "El infinito en un junco");
  assert.equal(found.author, "Irene Vallejo");
  assert.equal(found.category, "Humanidades");
  assert.equal(repo.bookByIsbn("9783406853388")?.title, "Die Antiquiertheit des Menschen I");
  assert.equal(repo.bookByIsbn("0000000000000"), null);
});

test("un ISBN que no está en el catálogo no devuelve nada (ficha nueva)", () => {
  assert.equal(repo.bookByIsbn("9788499087016"), null);
  const created = repo.createListing("usr_ana", {
    title: "Libro inédito en el catálogo",
    author: "Autora Nueva",
    category: "Ciencias y técnica",
    condition: "Buen estado",
    isbn: "9788499087016",
    city: "Stuttgart",
    tags: ["Física"],
  });
  assert.equal(created.title, "Libro inédito en el catálogo");
  assert.equal(repo.bookByIsbn("9788499087016")?.title, "Libro inédito en el catálogo");
});

test("la base arranca en la versión de esquema que espera el código", () => {
  assert.equal(dbModule.getDb().pragma("user_version", { simple: true }), dbModule.SCHEMA_VERSION);
});
