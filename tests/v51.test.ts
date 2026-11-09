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
import { SITE_DESCRIPTION, SITE_TITLE, alternatesFor } from "../src/lib/seo.ts";

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

/**
 * El título y la descripción son los dos textos que Google enseña tal cual (si
 * la descripción le parece buena). Pasarse de largo hace que los corte él, y
 * quedarse corto desperdicia el espacio; una descripción abstracta la sustituye
 * por un trozo de la página, que fue justo lo que pasó: el resultado mostraba
 * los pasos de «cómo funciona» en vez de qué es el sitio.
 */
test("la descripción de la portada cabe en un resultado de Google", () => {
  for (const locale of ["de", "es", "en"] as const) {
    const texto = SITE_DESCRIPTION[locale];
    assert.ok(
      texto.length >= 100 && texto.length <= 160,
      `${locale}: ${texto.length} caracteres (se buscan entre 100 y 160)`,
    );
  }
  // Cada idioma dice lo mismo con sus palabras: si dos coinciden, falta una.
  assert.equal(new Set(Object.values(SITE_DESCRIPTION)).size, 3);
});

test("el título no se pasa de largo ni se queda sin la consulta", () => {
  for (const locale of ["de", "es", "en"] as const) {
    const texto = SITE_TITLE[locale];
    assert.ok(texto.length <= 65, `${locale}: ${texto.length} caracteres`);
    assert.ok(
      /Bücher|libros|books/i.test(texto),
      `${locale}: el título no habla de libros`,
    );
  }
});
