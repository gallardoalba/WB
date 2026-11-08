import assert from "node:assert/strict";
import { before, test } from "node:test";

// La URL pública se lee al llamar, no al importar: basta con fijarla antes.
process.env.NEXT_PUBLIC_SITE_URL = "https://wanderbibliothek.org";

type Social = typeof import("../src/lib/social.ts");
let social: Social;

before(async () => {
  social = await import("../src/lib/social.ts");
});

/**
 * Las tarjetas sociales.
 *
 * Un fallo que no se ve en el navegador: declarar `openGraph` en una página
 * sustituye el objeto entero del layout, no lo completa, así que las fichas se
 * quedaron sin `og:image` y los enlaces compartidos salían sin vista previa.
 * Estas pruebas fijan lo que un rastreador necesita encontrar.
 */
test("siempre hay og:image, y absoluta", () => {
  const { openGraph } = social.socialMetadata({
    locale: "de",
    path: "/werk/bok_1",
    title: "Der Proceß — Franz Kafka",
    description: "Un ejemplar para intercambiar.",
    type: "book",
  });
  const images = openGraph?.images as { url: string; width?: number; height?: number }[];
  assert.equal(images.length, 1);
  assert.match(images[0]!.url, /^https:\/\//, "una og:image relativa no la lee ningún rastreador");
  // Sin imagen propia se cae a la tarjeta del sitio, que ya sabe su tamaño.
  assert.equal(images[0]!.url, "https://wanderbibliothek.org/api/og/de");
  assert.equal(images[0]!.width, 1200);
  assert.equal(images[0]!.height, 630);
});

test("la portada de la obra manda sobre la tarjeta del sitio", () => {
  const { openGraph } = social.socialMetadata({
    locale: "es",
    path: "/werk/bok_1",
    title: "«1984» de George Orwell",
    description: "Un ejemplar.",
    image: "/api/cover/book/bok_1",
    type: "book",
  });
  const images = openGraph?.images as { url: string; width?: number }[];
  assert.equal(images[0]!.url, "https://wanderbibliothek.org/api/cover/book/bok_1");
  // Una portada no mide 1200×630: declararlo recortaría la vista previa.
  assert.equal(images[0]!.width, undefined);
});

test("la URL social lleva el prefijo de idioma", () => {
  const de = social.socialMetadata({
    locale: "de",
    path: "/werk/bok_1",
    title: "T",
    description: "D",
    type: "book",
  });
  const es = social.socialMetadata({
    locale: "es",
    path: "/werk/bok_1",
    title: "T",
    description: "D",
    type: "book",
  });
  assert.equal(de.openGraph?.url, "https://wanderbibliothek.org/werk/bok_1");
  assert.equal(es.openGraph?.url, "https://wanderbibliothek.org/es/werk/bok_1");
  assert.equal(es.openGraph?.locale, "es_ES");
  assert.equal(de.openGraph?.locale, "de_DE");
  assert.equal(social.ogLocale("en"), "en_GB");
});

test("Twitter repite el título de la página, no el del sitio", () => {
  const { twitter } = social.socialMetadata({
    locale: "de",
    path: "/werk/bok_1",
    title: "Der Proceß — Franz Kafka",
    description: "Un ejemplar.",
    type: "book",
  });
  assert.equal(twitter?.card, "summary_large_image");
  assert.equal(twitter?.title, "Der Proceß — Franz Kafka");
});

test("acepta una imagen ya absoluta sin duplicar el dominio", () => {
  const { openGraph } = social.socialMetadata({
    locale: "de",
    path: "/werk/bok_1",
    title: "T",
    description: "D",
    image: "https://cdn.example/cover.jpg",
    type: "book",
  });
  const images = openGraph?.images as { url: string }[];
  assert.equal(images[0]!.url, "https://cdn.example/cover.jpg");
});
