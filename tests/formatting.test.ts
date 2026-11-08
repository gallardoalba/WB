/**
 * Formato de fechas, números y distancias por idioma.
 *
 * El servidor y el navegador tienen que pintar el mismo texto: si se usa
 * `toLocaleString()` sin fijar la zona o el idioma, la hidratación cambia el
 * texto entre el HTML y el cliente. Aquí se fija el resultado de cada idioma y
 * los respaldos (fecha inválida, distancia desconocida, encuentro sin fecha).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDistance, formatMeeting, formatNumber, formatWhen } from "../src/lib/text.ts";
import { localeTag, normalizeLocale, pick } from "../src/lib/locale.ts";

// Mediodía en UTC: en Berlín son las 11:00 (o las 12:00 en verano), así que el
// día nunca se cruza por la zona horaria.
const ISO = "2026-11-08T10:00:00.000Z";

test("la fecha corta se escribe en el idioma pedido y en hora de Berlín", () => {
  assert.match(formatWhen(ISO, "es"), /^8\s+nov\.?$/i);
  assert.match(formatWhen(ISO, "de"), /^8\.\s+Nov\.?$/i);
  assert.match(formatWhen(ISO, "en"), /^8\s+Nov$/i);
  // El idioma base es el alemán.
  assert.equal(formatWhen(ISO), formatWhen(ISO, "de"));
});

test("una fecha inválida no se pinta como «Invalid Date»", () => {
  for (const roto of ["", "no-es-fecha", "2026-13-40"]) {
    assert.equal(formatWhen(roto), "");
  }
});

test("la distancia usa coma decimal y no presume cuando no se sabe", () => {
  assert.equal(formatDistance(1.5), "1,5 km");
  assert.equal(formatDistance(1.5, "de"), "1,5 km");
  // Sin ciudad conocida, cada idioma tiene su aviso.
  assert.equal(formatDistance(null, "de"), "Ohne Angabe");
  assert.equal(formatDistance(null, "en"), "No distance");
  assert.equal(formatDistance(null, "es"), "Sin distancia");
  assert.equal(formatDistance(null), "Ohne Angabe");
});

test("el encuentro usa la fecha si la hay y la cadencia libre si no", () => {
  assert.match(formatMeeting(ISO, "último martes, 19:00", "es"), /8.*nov.*11:00/i);
  assert.match(formatMeeting(ISO, "sobrescrito", "de"), /8.*Nov.*11:00/i);
  assert.match(formatMeeting(ISO, "sobrescrito", "en"), /8.*Nov.*11:00/i);
  // Sin fecha se muestra el texto tal cual lo escribió el club.
  assert.equal(formatMeeting("", "último martes, 19:00"), "último martes, 19:00");
  // Una fecha rota no deja la etiqueta vacía.
  assert.equal(formatMeeting("no-es-fecha", "cada dos semanas", "es"), "cada dos semanas");
});

test("los números llevan el separador de cada idioma", () => {
  assert.match(formatNumber(1234.5, "es"), /^1?\.?234,5$/);
  assert.match(formatNumber(1234.5, "de"), /^1\.234,5$/);
  assert.match(formatNumber(1234.5, "en"), /^1,234\.5$/);
  assert.equal(formatNumber(7, "de"), "7");
});

test("la etiqueta BCP-47 y el texto de respaldo", () => {
  assert.equal(localeTag("es"), "es-ES");
  assert.equal(localeTag("de"), "de-DE");
  assert.equal(localeTag("en"), "en-GB");

  const textos = {
    es: "Castellano",
    de: "Deutsch",
    en: "English",
  };
  assert.equal(pick("es", textos), "Castellano");
  assert.equal(pick("de", textos), "Deutsch");
  // Un diccionario incompleto cae al idioma base, no a una cadena vacía.
  const incompleto = { de: "Deutsch" } as Record<"es" | "de" | "en", string>;
  assert.equal(pick("en", incompleto), "Deutsch");
});

test("un idioma desconocido se normaliza al base", () => {
  assert.equal(normalizeLocale("fr-FR"), "de");
  assert.equal(normalizeLocale(" EN-gb "), "en");
  assert.equal(normalizeLocale("ES"), "es");
  assert.equal(normalizeLocale(undefined), "de");
});
