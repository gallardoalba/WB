import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CATEGORIES,
  TAGS,
  TAGS_BY_CATEGORY,
  tagsForCategory,
  type Category,
} from "../src/lib/domain.ts";
import { listingSchema } from "../src/lib/validation.ts";

/**
 * Etiquetas temáticas por género y ISBN obligatorio.
 *
 * Las etiquetas de antes describían el escaparate («Novela negra», «Firmado»,
 * «Primera edición») y no el contenido, así que no ayudaban a encontrar un
 * libro por lo que trata. Estas pruebas fijan la taxonomía nueva y que el ISBN
 * sea obligatorio al publicar.
 */

const BASE = {
  title: "El nombre de la rosa",
  author: "Umberto Eco",
  category: "Ficción",
  condition: "Buen estado",
  city: "Freiburg im Breisgau",
};

/** Etiquetas retiradas a propósito: no deben volver sin una decisión explícita. */
const RETIRED = [
  "Novela negra",
  "Romántica",
  "Actualidad",
  "Memorias",
  "Bibliografía",
  "Firmado",
  "Primera edición",
  "Infantil",
  "Juvenil",
  "Viajes",
  "Manual",
  "Autoayuda",
  "Cómic",
  "Bestseller",
];

test("el ISBN es obligatorio al publicar un libro", () => {
  const missing = listingSchema.safeParse({ ...BASE, tags: [] });
  assert.equal(missing.success, false);
  assert.match(String(missing.error?.issues[0]?.message), /ISBN/i);

  const empty = listingSchema.safeParse({ ...BASE, isbn: "   ", tags: [] });
  assert.equal(empty.success, false);
  assert.match(String(empty.error?.issues[0]?.message), /Escribe el ISBN/i);
});

test("el ISBN se normaliza y se rechaza si el dígito de control no cuadra", () => {
  const ok = listingSchema.safeParse({ ...BASE, isbn: "978-84-1786-079-0", tags: [] });
  assert.equal(ok.success, true);
  assert.equal(ok.data?.isbn, "9788417860790");

  const bad = listingSchema.safeParse({ ...BASE, isbn: "9788417860791", tags: [] });
  assert.equal(bad.success, false);
  assert.match(String(bad.error?.issues[0]?.message), /no es válido/i);
});

test("cada género propone sus etiquetas y ninguna queda huérfana", () => {
  for (const category of CATEGORIES) {
    const offered = tagsForCategory(category);
    assert.ok(offered.length > 0, `${category} no propone etiquetas`);
    for (const tag of offered) {
      assert.ok((TAGS as readonly string[]).includes(tag), `${tag} no está en TAGS`);
    }
  }
  const orphans = TAGS.filter(
    (tag) => !CATEGORIES.some((category) => tagsForCategory(category).includes(tag)),
  );
  assert.deepEqual(orphans, [], "hay etiquetas que ningún género propone");
});

test("los géneros de ficción y de ciencias no comparten el mismo vocabulario", () => {
  const ficcion = tagsForCategory("Ficción");
  const ciencias = tagsForCategory("Ciencias y técnica");
  assert.ok(ficcion.includes("Narrativa"));
  assert.ok(!ficcion.includes("Física"));
  assert.ok(ciencias.includes("Física"));
  assert.ok(!ciencias.includes("Narrativa"));
});

test("un género desconocido no propone etiquetas en lugar de fallar", () => {
  assert.deepEqual(tagsForCategory("Género inventado"), []);
  assert.deepEqual(tagsForCategory(""), []);
});

test("las etiquetas retiradas ya no existen en la taxonomía", () => {
  for (const retired of RETIRED) {
    assert.ok(!(TAGS as readonly string[]).includes(retired), `«${retired}» sigue en TAGS`);
    for (const category of CATEGORIES) {
      const offered: readonly string[] = TAGS_BY_CATEGORY[category as Category];
      assert.ok(!offered.includes(retired), `«${retired}» sigue en ${category}`);
    }
  }
});

test("publicar con una etiqueta de otro género sigue siendo válido", () => {
  // La UI solo propone las del género, pero el servidor no rompe datos que ya
  // existían: acepta cualquier etiqueta curada de la lista global.
  const parsed = listingSchema.safeParse({
    ...BASE,
    isbn: "9788417860790",
    tags: ["Narrativa", "Filosofía"],
  });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data?.tags, ["Narrativa", "Filosofía"]);
});

test("una etiqueta inventada se descarta en vez de guardarse", () => {
  const parsed = listingSchema.safeParse({
    ...BASE,
    isbn: "9788417860790",
    tags: ["Narrativa", "Novela negra"],
  });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data?.tags, ["Narrativa"]);
});
