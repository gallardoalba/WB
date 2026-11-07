/**
 * Idioma por URL (`/es/…`, `/en/…`) y sus `hreflang`.
 *
 * Lo que se fija aquí es el contrato de las direcciones: el alemán va sin
 * prefijo y es el `x-default`, cada idioma se anuncia a sí mismo como canonical
 * y los otros dos como alternativos. Si esto cambia, Google deja de relacionar
 * las tres versiones y solo indexa una.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { HREFLANG, LOCALE_PREFIX, localePath, splitLocalePath } from "../src/lib/locale.ts";
import { alternatesFor } from "../src/lib/seo.ts";

test("el alemán va sin prefijo y los otros dos con el suyo", () => {
  assert.equal(LOCALE_PREFIX.de, "");
  assert.equal(localePath("de", "/werk/x"), "/werk/x");
  assert.equal(localePath("es", "/werk/x"), "/es/werk/x");
  assert.equal(localePath("en", "/werk/x"), "/en/werk/x");
});

test("la portada de cada idioma es el prefijo a secas", () => {
  assert.equal(localePath("de", "/"), "/");
  assert.equal(localePath("es", "/"), "/es");
  assert.equal(localePath("en", "/"), "/en");
});

test("una ruta sin barra inicial no duplica la barra", () => {
  assert.equal(localePath("es", "werk/x"), "/es/werk/x");
});

test("se separa el prefijo de la ruta interna", () => {
  assert.deepEqual(splitLocalePath("/es/werk/x"), { locale: "es", path: "/werk/x" });
  assert.deepEqual(splitLocalePath("/es"), { locale: "es", path: "/" });
  assert.deepEqual(splitLocalePath("/de/listas"), { locale: "de", path: "/listas" });
});

test("una ruta que solo empieza por las letras del idioma no lleva prefijo", () => {
  assert.equal(splitLocalePath("/escribir"), null);
  assert.equal(splitLocalePath("/entrar"), null);
  assert.equal(splitLocalePath("/werk/x"), null);
  assert.equal(splitLocalePath("/"), null);
});

test("el canonical es el de la propia versión y las alternativas las tres", () => {
  const alternates = alternatesFor("es", "/werk/x");
  assert.equal(alternates?.canonical, "/es/werk/x");
  assert.deepEqual(alternates?.languages, {
    "de-DE": "/werk/x",
    "es-ES": "/es/werk/x",
    "en-GB": "/en/werk/x",
    "x-default": "/werk/x",
  });
});

test("en alemán el canonical es la ruta sin prefijo", () => {
  const alternates = alternatesFor("de", "/listas");
  assert.equal(alternates?.canonical, "/listas");
  assert.equal(
    (alternates?.languages as Record<string, string>)?.["x-default"],
    "/listas",
  );
});

test("las etiquetas hreflang son las que espera Google", () => {
  assert.equal(HREFLANG.de, "de-DE");
  assert.equal(HREFLANG.es, "es-ES");
  assert.equal(HREFLANG.en, "en-GB");
});
