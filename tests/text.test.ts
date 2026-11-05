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
import { normalizeLocale } from "../src/lib/locale.ts";

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
  assert.equal(isValidIsbn("9788413528380"), true);
  assert.equal(isValidIsbn("123"), false);
  // Un dígito cambiado en el ISBN real (el 8 final no cuadra) se detecta.
  assert.equal(isValidIsbn("9788413528388"), false);
  assert.equal(coverFromIsbn("9788413528380"), "/api/cover/9788413528380");
  assert.equal(coverFromIsbn(null), null);
});

test("formatDistance usa coma decimal y el idioma por defecto", () => {
  assert.equal(formatDistance(1.2), "1,2 km");
  // Sin ciudad conocida no se presume cercanía. El idioma base es el alemán.
  assert.equal(formatDistance(null), "Ohne Angabe");
  assert.equal(formatDistance(null, "es"), "Sin distancia");
});

test("sin preferencia guardada la interfaz habla alemán", () => {
  assert.equal(normalizeLocale(undefined), "de");
  assert.equal(normalizeLocale(null), "de");
  assert.equal(normalizeLocale(""), "de");
  assert.equal(normalizeLocale("fr"), "de");
  assert.equal(normalizeLocale("es"), "es");
  // Una cabecera regional también se reconoce.
  assert.equal(normalizeLocale("es-ES"), "es");
  assert.equal(normalizeLocale("DE-de"), "de");
});

test("toneForId es determinista", () => {
  assert.equal(toneForId("lst_1"), toneForId("lst_1"));
});
