/**
 * v59: archivar un intercambio, sin tocar el intercambio.
 *
 * El cajón es personal: una fila por persona y solicitud. Esta prueba fija lo
 * que no debe romperse al subir una base antigua: la tabla aparece, no se
 * pierde ninguna solicitud y al borrar la cuenta desaparece su cajón.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import Database from "better-sqlite3";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";

type Db = Database.Database;

const NOW = "2026-01-01T10:00:00.000Z";

function fresh(): Db {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

/** Lo mínimo para que exista un intercambio entre dos cuentas. */
function sembrarIntercambio(db: Db): void {
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, 'x', ?)",
  ).run("usr_a", "Ana", "ana@example.test", NOW);
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, 'x', ?)",
  ).run("usr_b", "Bruno", "bruno@example.test", NOW);
  db.prepare(
    `INSERT INTO books (id, title, title_key, author, category, created_at)
     VALUES ('bok_1', 'Un libro', 'un libro', 'Alguien', 'Ficción', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO listings (id, book_id, owner_id, condition, city, created_at)
     VALUES ('lst_1', 'bok_1', 'usr_b', 'Buen estado', 'Stuttgart', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO requests (id, listing_id, requester_id, owner_id, status, created_at, updated_at)
     VALUES ('req_1', 'lst_1', 'usr_a', 'usr_b', 'completed', ?, ?)`,
  ).run(NOW, NOW);
}

test("una base nueva trae el cajón y está en la versión vigente", () => {
  const db = fresh();
  const tablas = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((row) => row.name);

  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.ok(tablas.includes("request_archives"));
});

test("una base de la v58 gana el cajón sin tocar las solicitudes", () => {
  const db = fresh();
  sembrarIntercambio(db);

  // Se retrocede al escalón anterior: sin la tabla y con la marca en 58.
  db.exec("DROP TABLE request_archives");
  db.pragma("user_version = 58");

  migrate(db);

  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM requests").get() as { count: number }).count,
    1,
    "ninguna solicitud se pierde al subir",
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM request_archives").get() as { count: number }).count,
    0,
    "el cajón nace vacío",
  );
});

test("el cajón no sobrevive ni al intercambio ni a la cuenta", () => {
  const db = fresh();
  sembrarIntercambio(db);
  db.prepare(
    "INSERT INTO request_archives (request_id, user_id, archived_at) VALUES ('req_1', 'usr_a', ?)",
  ).run(NOW);

  // Las dos claves ajenas borran en cascada: no queda basura si desaparece la
  // solicitud (o, tras borrar sus intercambios, la cuenta).
  const claves = db.pragma("foreign_key_list(request_archives)") as {
    table: string;
    on_delete: string;
  }[];
  const enCascada = Object.fromEntries(claves.map((clave) => [clave.table, clave.on_delete]));
  assert.equal(enCascada.requests, "CASCADE");
  assert.equal(enCascada.users, "CASCADE");

  db.prepare("DELETE FROM requests WHERE id = 'req_1'").run();
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM request_archives").get() as { count: number }).count,
    0,
    "la fila se va con el intercambio",
  );
});
