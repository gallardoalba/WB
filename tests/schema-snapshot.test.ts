/**
 * Red de seguridad de la escalera de migraciones.
 *
 * Una instalación nueva nace en `SCHEMA_V2` y sube 53 escalones. Eso es mucho
 * recorrido para confiar solo en que cada paso se probó el día que se escribió:
 * aquí se fija el **esquema final** completo. Un squash futuro (una base nueva
 * para instalaciones nuevas) tiene que dejar esta instantánea idéntica, y
 * cualquier migración que cambie el esquema obliga a revisar el diff a mano.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import Database from "better-sqlite3";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";
import { dumpSchema, SNAPSHOT } from "../src/lib/db/schema-dump.ts";

function freshDatabase() {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

test("el esquema final coincide con la instantánea", () => {
  const db = freshDatabase();
  const expected = readFileSync(path.join(process.cwd(), SNAPSHOT), "utf8");
  assert.equal(
    dumpSchema(db),
    expected,
    "Si el cambio de esquema es intencionado: npm run db:schema-snapshot y revisa el diff",
  );
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  db.close();
});

test("cada escalón definido se ejecuta en migrate()", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "lib", "db", "migrations.ts"),
    "utf8",
  );
  const defined = [...source.matchAll(/^function migrateToV(\d+)\(/gm)].map((match) =>
    Number(match[1]),
  );
  const called = [
    ...source.matchAll(/if \(userVersion\(db\) < (\d+)\) migrateToV(\d+)\(db\);/g),
  ].map((match) => {
    assert.equal(match[1], match[2], `el pasillo compara v${match[1]} y ejecuta v${match[2]}`);
    return Number(match[2]);
  });

  assert.deepEqual(
    [...defined].sort((a, b) => a - b),
    [...called].sort((a, b) => a - b),
    "hay funciones de migración que ningún pasillo ejecuta (o al revés)",
  );
  assert.equal(defined.length, SCHEMA_VERSION - 2, "el número de escalones no cuadra con la versión");
});
