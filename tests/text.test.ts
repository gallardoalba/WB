import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coverFromIsbn,
  formatDistance,
  initialsOf,
  isValidIsbn,
  matchesQuery,
  normalizeIsbn,
  normalizeText,
  toneForId,
} from "../src/lib/text.ts";

test("normalizeText elimina acentos, mayúsculas y signos", () => {
  assert.equal(normalizeText("  Martínez, Lucía  "), "martinez lucia");
  assert.equal(normalizeText("Ilíada"), "iliada");
});

test("matchesQuery ignora acentos en la consulta y en el texto", () => {
  assert.equal(matchesQuery("La educación", "educacion"), true);
  assert.equal(matchesQuery("Fantasía épica", "fantasia epica"), true);
  assert.equal(matchesQuery("El infinito en un junco", "martinez"), false);
});

test("matchesQuery exige todas las palabras pero no el orden", () => {
  assert.equal(matchesQuery("Poeta chileno", "chileno poeta"), true);
  assert.equal(matchesQuery("Cien años de soledad", "cien soledad"), true);
  assert.equal(matchesQuery("Cien años de soledad", "cien ausencia"), false);
});

test("matchesQuery con consulta vacía devuelve true", () => {
  assert.equal(matchesQuery("Cualquier libro", "   "), true);
});

test("initialsOf usa como máximo dos iniciales", () => {
  assert.equal(initialsOf("Ana María López"), "AM");
  assert.equal(initialsOf("clara"), "C");
});

test("normaliza y valida ISBN", () => {
  assert.equal(normalizeIsbn("978-84-13-5283-8"), "978841352838");
  assert.equal(isValidIsbn("9788413528388"), true);
  assert.equal(isValidIsbn("123"), false);
  assert.equal(coverFromIsbn("9788413528388"), "https://covers.openlibrary.org/b/isbn/9788413528388-L.jpg");
  assert.equal(coverFromIsbn(null), null);
});

test("formatDistance usa coma decimal y valor por defecto", () => {
  assert.equal(formatDistance(1.2), "1,2 km");
  // Sin ciudad conocida no se presume cercanía.
  assert.equal(formatDistance(null), "Sin distancia");
});

test("toneForId es determinista", () => {
  assert.equal(toneForId("lst_1"), toneForId("lst_1"));
});
