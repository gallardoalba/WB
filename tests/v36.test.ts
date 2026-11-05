import assert from "node:assert/strict";
import { before, test } from "node:test";

import {
  categoryFromSubjects,
  languageFromCodes,
  mergeSources,
  parseDnbCreator,
  parseDnbTitle,
  tagsFromSubjects,
} from "../src/lib/isbn-metadata.ts";
import { workKeyFromOpenLibrary, workKeyFromTitle } from "../src/lib/work.ts";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
let repo: RepoModule;

before(async () => {
  await import("../src/lib/db/index.ts");
  repo = await import("../src/lib/repo.ts");
});

/**
 * Autocompletado desde el ISBN y agrupación de ediciones.
 *
 * El título y la autoría no se escriben a mano: salen del ISBN. Estas pruebas
 * fijan cómo se leen los datos de la DNB y de Open Library, cómo se deduce el
 * género y el idioma, y que dos ISBN del mismo libro caigan en la misma obra.
 */

test("la clave de obra ignora mayúsculas, acentos y subtítulo", () => {
  const base = workKeyFromTitle("El infinito en un junco", "Irene Vallejo");
  assert.equal(workKeyFromTitle("EL INFINITO EN UN JUNCO", "irene vallejo"), base);
  assert.equal(
    workKeyFromTitle("El infinito en un junco: La invención de los libros", "Irene Vallejo"),
    base,
    "el subtítulo no puede separar dos ediciones",
  );
  assert.equal(
    workKeyFromTitle("El infinito en un junco", "Vallejo, Irene"),
    workKeyFromTitle("El infinito en un junco", "Irene Vallejo"),
    "el apellido manda, no el orden",
  );
  assert.notEqual(workKeyFromTitle("El infinito en un junco", "Irene Vallejo"), workKeyFromTitle("Otro libro", "Irene Vallejo"));
  assert.notEqual(base, workKeyFromTitle("El infinito en un junco", "Otra persona"));
});

test("la clave de Open Library identifica la obra, no la edición", () => {
  assert.equal(workKeyFromOpenLibrary("/works/OL20770492W"), "ol:OL20770492W");
  assert.equal(workKeyFromOpenLibrary("OL20770492W"), "ol:OL20770492W");
});

test("el idioma se deduce de los códigos de catálogo", () => {
  assert.equal(languageFromCodes(["ger"]), "Alemán");
  assert.equal(languageFromCodes(["spa"]), "Español");
  assert.equal(languageFromCodes(["eng"]), "Inglés");
  assert.equal(languageFromCodes(["fre"]), "Otro");
  assert.equal(languageFromCodes([]), null);
});

test("el género se deduce de la DDC alemana y de los temas de Open Library", () => {
  // Casos reales de la DNB.
  assert.equal(categoryFromSubjects(["830 Deutsche Literatur", "B Belletristik"]), "Ficción");
  assert.equal(categoryFromSubjects(["300 Sozialwissenschaften, Soziologie", "320 Politik"]), "Sociedad y política");
  assert.equal(categoryFromSubjects(["100 Philosophie"]), "Humanidades");
  assert.equal(categoryFromSubjects(["500 Naturwissenschaften"]), "Ciencias y técnica");
  assert.equal(categoryFromSubjects(["920 Biografie, Genealogie"]), "Biografías");
  // Temas de Open Library.
  assert.equal(categoryFromSubjects(["Fiction", "Fantasy"]), "Ficción");
  assert.equal(categoryFromSubjects(["History", "Philosophy"]), "Humanidades");
  assert.equal(categoryFromSubjects(["Mental Health", "Psychology"]), "Sociedad y política");
  assert.equal(categoryFromSubjects([]), null);
});

test("las etiquetas propuestas respetan el género elegido", () => {
  const subjects = ["Geschichte", "Politik", "Philosophie"];
  const humanidades = tagsFromSubjects(subjects, ["Historia", "Filosofía", "Literatura"]);
  assert.deepEqual(humanidades, ["Historia", "Filosofía"]);
  const sociedad = tagsFromSubjects(subjects, ["Política", "Sociología"]);
  assert.deepEqual(sociedad, ["Política"]);
  // Nunca más de tres.
  assert.ok(tagsFromSubjects(["Geschichte", "Politik", "Philosophie", "Kunst"], ["Historia", "Política", "Filosofía", "Arte"]).length <= 3);
});

test("el título de la DNB se limpia: sin título original ni mención de responsabilidad", () => {
  assert.deepEqual(parseDnbTitle("Gegen den Hass / Carolin Emcke"), {
    title: "Gegen den Hass",
    subtitle: null,
  });
  assert.deepEqual(
    parseDnbTitle("[De moeder van Ikabod] ; So viele Hähne, so nah beim Haus : Erzählungen / Maarten 't Hart"),
    { title: "So viele Hähne, so nah beim Haus", subtitle: "Erzählungen" },
  );
});

test("la autoría de la DNB se ordena y descarta traductores", () => {
  assert.equal(parseDnbCreator("Emcke, Carolin [Verfasser]"), "Carolin Emcke");
  assert.equal(parseDnbCreator("Hart, Maarten 't [Verfasser]"), "Maarten 't Hart");
  assert.equal(parseDnbCreator("Seferens, Gregor [Übersetzer]"), null);
  assert.equal(parseDnbCreator(""), null);
});

test("al combinar fuentes manda la DNB y Open Library aporta la obra", () => {
  const merged = mergeSources(
    { title: "Gegen den Hass", authors: ["Carolin Emcke"], languages: ["ger"], subjects: ["300 Sozialwissenschaften"] },
    { title: "Against hate", authors: ["Carol Emcke"], languages: ["eng"], subjects: ["Fiction"], workId: "/works/OL123W" },
    (category, subjects) => (category ? tagsFromSubjects(subjects, ["Política"]) : []),
  );
  assert.ok(merged);
  assert.equal(merged.title, "Gegen den Hass", "el título es el de la edición alemana");
  assert.deepEqual(merged.authors, ["Carolin Emcke"]);
  assert.equal(merged.language, "Alemán");
  assert.equal(merged.category, "Sociedad y política");
  assert.equal(merged.workId, "/works/OL123W");
  assert.equal(merged.source, "dnb+openlibrary");
  // Sin datos de ninguna de las dos no se inventa una ficha.
  assert.equal(mergeSources(null, null, () => []), null);
});

test("dos ISBN del mismo libro acaban en la misma obra y comparten ejemplares", () => {
  const first = repo.createListing("usr_ana", {
    title: "La sombra del viento",
    author: "Carlos Ruiz Zafón",
    category: "Ficción",
    condition: "Buen estado",
    isbn: "9788408043645",
    city: "Stuttgart",
    tags: [],
  });
  // Otra edición: otro ISBN, el mismo libro (con subtítulo, además).
  const second = repo.createListing("usr_clara", {
    title: "La sombra del viento: El cementerio de los libros olvidados",
    author: "Carlos Ruiz Zafón",
    category: "Ficción",
    condition: "Como nuevo",
    isbn: "9788401351112",
    city: "Mannheim",
    tags: [],
  });

  // Son libros distintos (cada ISBN es una edición)…
  assert.notEqual(first.bookId, second.bookId);
  // …pero una sola obra.
  const editions = repo.workBooks(first.bookId).map((book) => book.id);
  assert.deepEqual([...editions].sort(), [first.bookId, second.bookId].sort());

  // Y los ejemplares se cuentan y se listan juntos.
  assert.equal(repo.countListingsForBook(first.bookId, null), 2);
  const copies = repo.listingsForBook(first.bookId, null);
  assert.deepEqual(copies.map((copy) => copy.id).sort(), [first.id, second.id].sort());
  // Buscar por una edición también encuentra la copia de la otra.
  const inMannheim = repo.listingsForBook(first.bookId, null, { city: "Mannheim" });
  assert.deepEqual(inMannheim.map((copy) => copy.id), [second.id]);
});
