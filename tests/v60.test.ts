/**
 * v60 amplía la matriz de distancias a Austria sin renombrar las ciudades
 * alemanas guardadas en los perfiles.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import Database from "better-sqlite3";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";

test("una base v59 añade ciudades austríacas y distancias sin alterar perfiles", () => {
  const db = new Database(":memory:");
  migrate(db);

  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, city, created_at) VALUES ('usr_1', 'Ada', 'ada@example.test', 'x', 'München', '2026-01-01T00:00:00.000Z')",
  ).run();
  db.exec(`
    DELETE FROM city_distances WHERE from_name LIKE '% (AT)' OR to_name LIKE '% (AT)';
    DELETE FROM cities WHERE name LIKE '% (AT)';
    PRAGMA user_version = 59;
  `);

  migrate(db);

  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.equal(
    (db.prepare("SELECT city FROM users WHERE id = 'usr_1'").get() as { city: string }).city,
    "München",
  );
  assert.ok(
    db.prepare("SELECT 1 FROM cities WHERE name = 'Wien'").get(),
    "la ciudad austríaca está disponible para calcular distancias",
  );
  const distance = db
    .prepare("SELECT km FROM city_distances WHERE from_name = 'München' AND to_name = 'Wien'")
    .get() as { km: number } | undefined;
  assert.ok(distance && distance.km > 300 && distance.km < 500);

  db.close();
});
