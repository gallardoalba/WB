/**
 * v57: la obra pasa a ser una entidad.
 *
 * Lo que se fija aquí es que la migración **no cambia la agrupación**: cada
 * clave de obra de la v56 se convierte en una fila de `works`, todas sus
 * ediciones apuntan a ella y la ficha canónica es la de la edición más antigua.
 * Y que una fila sin clave se queda sin obra en lugar de mezclarse con las
 * demás: es la diferencia entre «no sé a qué obra pertenece» y «es su propia
 * obra».
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import Database from "better-sqlite3";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";
import { ensureWork, moveWorkEditions, workIdForBook } from "../src/lib/repo/works.ts";

type Db = Database.Database;

function databaseAt(version: number): Db {
  const db = new Database(":memory:");
  migrate(db);
  // Se retrocede la marca para volver a recorrer el último escalón.
  db.pragma(`user_version = ${version}`);
  return db;
}

function insertBook(
  db: Db,
  id: string,
  title: string,
  workKey: string | null,
  createdAt: string,
  author = "Miguel de Cervantes",
): void {
  db.prepare(
    `INSERT INTO books (id, title, title_key, author, isbn, category, language, work_key, created_at)
     VALUES (?, ?, ?, ?, NULL, 'Ficción', 'Español', ?, ?)`,
  ).run(id, title, title.toLowerCase(), author, workKey, createdAt);
}

test("una base de la v56 sube a la v57 conservando la agrupación", () => {
  const db = databaseAt(56);
  insertBook(db, "bok_a", "Don Quijote de la Mancha", "t:dq", "2026-01-01T10:00:00.000Z");
  insertBook(db, "bok_b", "Don Quijote de la Mancha", "t:dq", "2026-02-01T10:00:00.000Z");
  insertBook(db, "bok_c", "Novela de otro autor", "t:otra", "2026-03-01T10:00:00.000Z",
    "Otra Autora");

  migrate(db);

  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);

  const works = db.prepare("SELECT id, key, title FROM works ORDER BY key").all() as {
    id: string;
    key: string;
    title: string;
  }[];
  assert.equal(works.length, 2);
  assert.deepEqual(works.map((work) => work.key), ["t:dq", "t:otra"]);

  // Las dos ediciones de la misma obra comparten id...
  const a = workIdForBook(db, "bok_a");
  const b = workIdForBook(db, "bok_b");
  assert.ok(a);
  assert.equal(a, b);
  // ...y la ficha canónica es la de la edición más antigua.
  const canonical = works.find((work) => work.key === "t:dq");
  assert.equal(canonical?.id, a);
  assert.equal(canonical?.title, "Don Quijote de la Mancha");

  // La otra obra no se ha mezclado.
  assert.notEqual(workIdForBook(db, "bok_c"), a);
  db.close();
});

test("una edición sin clave se queda sin obra, no se agrupa con las demás", () => {
  const db = databaseAt(56);
  insertBook(db, "bok_x", "Sin clave uno", null, "2026-01-01T10:00:00.000Z");
  insertBook(db, "bok_y", "Sin clave dos", null, "2026-01-02T10:00:00.000Z");

  migrate(db);

  assert.equal(workIdForBook(db, "bok_x"), null);
  assert.equal(workIdForBook(db, "bok_y"), null);
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM works").get() as { count: number };
  assert.equal(count, 0);
  db.close();
});

test("la migración es idempotente", () => {
  const db = databaseAt(56);
  insertBook(db, "bok_a", "Don Quijote de la Mancha", "t:dq", "2026-01-01T10:00:00.000Z");

  migrate(db);
  migrate(db);
  migrate(db);

  const works = db.prepare("SELECT COUNT(*) AS count FROM works").get() as { count: number };
  assert.equal(works.count, 1);
  db.close();
});

test("ensureWork reutiliza la obra y no reescribe su ficha", () => {
  const db = databaseAt(56);
  migrate(db);

  const first = ensureWork(db, "t:dq", "Don Quijote de la Mancha", "Cervantes", "2026-01-01T00:00:00.000Z");
  // Otra edición con el título corregido: la obra conserva la ficha original.
  const second = ensureWork(db, "t:dq", "Don Quijote", "Miguel de Cervantes", "2026-02-01T00:00:00.000Z");

  assert.equal(first, second);
  const work = db.prepare("SELECT title, author FROM works WHERE id = ?").get(first) as {
    title: string;
    author: string;
  };
  assert.equal(work.title, "Don Quijote de la Mancha");
  assert.equal(work.author, "Cervantes");
  db.close();
});

test("cuando llega la obra de Open Library, las ediciones se mueven a ella", () => {
  const db = databaseAt(56);
  insertBook(db, "bok_a", "Don Quijote de la Mancha", "t:dq", "2026-01-01T10:00:00.000Z");
  insertBook(db, "bok_b", "Don Quijote de la Mancha", "t:dq", "2026-02-01T10:00:00.000Z");
  migrate(db);

  const before = workIdForBook(db, "bok_a");
  assert.ok(before);

  // Caso 1: la obra de destino aún no existe → se renombra la de origen, así
  // que el id no cambia (ninguna URL ni referencia queda apuntando a un hueco).
  const renamed = moveWorkEditions(db, "t:dq", "ol:OL123W", "2026-03-01T00:00:00.000Z");
  assert.equal(renamed, before);
  assert.equal(workIdForBook(db, "bok_b"), before);
  const key = db.prepare("SELECT key FROM works WHERE id = ?").get(renamed) as { key: string };
  assert.equal(key.key, "ol:OL123W");

  // Caso 2: ya existía otra obra con esa clave → las ediciones se mueven y la
  // obra vacía desaparece.
  const target = ensureWork(db, "ol:OL999W", "Otra", "Autora", "2026-01-01T00:00:00.000Z");
  const merged = moveWorkEditions(db, "ol:OL123W", "ol:OL999W", "2026-04-01T00:00:00.000Z");
  assert.equal(merged, target);
  assert.equal(workIdForBook(db, "bok_a"), target);
  const left = db.prepare("SELECT COUNT(*) AS count FROM works").get() as { count: number };
  assert.equal(left.count, 1);
  db.close();
});
