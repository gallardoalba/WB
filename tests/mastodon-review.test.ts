/**
 * Revisión de los avisos ya publicados (`--publicadas`).
 *
 * Lo que se fija aquí: el aviso alemán no se marca, el antiguo en castellano o
 * en inglés sí, y un título extranjero dentro de un aviso alemán no confunde a
 * la detección: el título se conserva siempre en su idioma original.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { composeStatus } from "../src/lib/mastodon-post.ts";
import { reviewPublished } from "../src/lib/mastodon-review.ts";

const BASE = {
  id: "soc_1",
  bookId: "bok_1",
  title: "Ficciones",
  author: "Jorge Luis Borges",
  url: "https://mastodon.social/@wanderbibliothek/1",
  sentAt: "2026-01-01T00:00:00.000Z",
};

const revisar = (body: string) => reviewPublished([{ ...BASE, body }])[0]!;

test("un aviso alemán no pide traducción", () => {
  const body = composeStatus({
    title: "Die Verwandlung",
    author: "Franz Kafka",
    url: "https://wanderbibliothek.org/werk/bok_1?ref=mastodon",
    seed: "bok_1",
    category: "Ficción",
  });
  const post = revisar(body);
  assert.equal(post.needsTranslation, false);
  assert.deepEqual(post.reasons, []);
});

test("un aviso publicado en castellano se marca con su motivo", () => {
  const post = revisar(
    "«Ficciones», de Jorge Luis Borges.\n\nhttps://wanderbibliothek.org/es/werk/bok_1?ref=mastodon\n\n#Wanderbibliothek #Libros #Lectura",
  );
  assert.equal(post.needsTranslation, true);
  assert.deepEqual(post.reasons, ["enlace con prefijo /es", "etiquetas castellanas"]);
});

test("un aviso publicado en inglés también se marca", () => {
  const post = revisar(
    "“Ficciones” by Jorge Luis Borges.\n\nhttps://wanderbibliothek.org/en/werk/bok_1?ref=mastodon\n\n#Wanderbibliothek #Books #Reading",
  );
  assert.equal(post.needsTranslation, true);
  assert.deepEqual(post.reasons, ["enlace con prefijo /en", "etiquetas inglesas"]);
});

test("un título extranjero dentro de un aviso alemán no confunde la revisión", () => {
  // El título se conserva en su idioma original: no es una señal de idioma.
  const body = composeStatus({
    title: "Cien años de soledad — edición conmemorativa",
    author: "Gabriel García Márquez",
    url: "https://wanderbibliothek.org/werk/bok_1?ref=mastodon",
    seed: "bok_1",
    category: "Ficción",
  });
  const post = revisar(body);
  assert.equal(post.needsTranslation, false);
  assert.ok(body.includes("Cien años de soledad"));
});

test("basta una etiqueta antigua para marcar el aviso", () => {
  const post = revisar(
    "Neu im Regal: „Ficciones“ von Jorge Luis Borges.\n\nhttps://wanderbibliothek.org/werk/bok_1?ref=mastodon\n\n#Wanderbibliothek #Bookstodon #Lesen",
  );
  assert.equal(post.needsTranslation, true);
  assert.deepEqual(post.reasons, ["etiquetas inglesas"]);
});

test("sin avisos no hay nada que revisar", () => {
  assert.deepEqual(reviewPublished([]), []);
});
