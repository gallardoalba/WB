/**
 * v56: el viaje del ejemplar y su interruptor de privacidad.
 *
 * Lo que se fija aquí es que una base de la v55 sube sin perder cuentas y que
 * la columna nueva nace **activada**: apagarla es una decisión de cada persona,
 * no el estado de partida.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import Database from "better-sqlite3";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";

/** Base actual a la que se le quita la columna y la marca de versión. */
function baseV55(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  db.exec("ALTER TABLE users DROP COLUMN show_journey");
  db.pragma("user_version = 55");
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, city, bio, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "usr_v55",
    "Lectora anterior",
    "anterior@example.test",
    "scrypt$00$00",
    "Leipzig",
    "Sigue aquí",
    "2025-01-01T00:00:00.000Z",
  );
  return db;
}

test("la v56 añade show_journey y conserva las cuentas", () => {
  const db = baseV55();
  migrate(db);

  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  const row = db
    .prepare("SELECT name, bio, show_journey FROM users WHERE id = ?")
    .get("usr_v55") as { name: string; bio: string; show_journey: number } | undefined;
  assert.ok(row, "la cuenta de la v55 desapareció al migrar");
  assert.equal(row.name, "Lectora anterior");
  assert.equal(row.bio, "Sigue aquí");
  assert.equal(row.show_journey, 1, "el recorrido nace activado");
  db.close();
});

test("migrar dos veces no duplica la columna ni cambia su valor", () => {
  const db = baseV55();
  migrate(db);
  db.prepare("UPDATE users SET show_journey = 0 WHERE id = ?").run("usr_v55");
  db.pragma("user_version = 55");
  migrate(db);

  const row = db
    .prepare("SELECT show_journey FROM users WHERE id = ?")
    .get("usr_v55") as { show_journey: number };
  assert.equal(row.show_journey, 0, "una segunda pasada no debe reactivar lo que se apagó");
  db.close();
});
