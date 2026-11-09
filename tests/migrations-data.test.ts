/**
 * Una base **antigua y con datos** que se actualiza a la versión actual.
 *
 * El resto de pruebas parten de una base vacía, así que la escalera
 * v39→v48 solo se ejecutaba sobre tablas sin filas: un `ALTER` que perdiera
 * datos pasaba desapercibido. El esquema de `tests/fixtures/schema-v38.sql` está
 * volcado de una base real creada con el código de `6fb533b` (la versión 38, la
 * más antigua que conserva el repositorio), así que esto no es una imitación del
 * esquema: es el esquema.
 *
 * Lo que se comprueba es lo que promete una actualización: las filas siguen
 * ahí, las columnas nuevas llegan con su valor por defecto, los índices de
 * búsqueda se reconstruyen con lo que ya había y las tablas nuevas existen.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import Database from "better-sqlite3";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";

const ESQUEMA_V38 = readFileSync(
  path.join(process.cwd(), "tests", "fixtures", "schema-v38.sql"),
  "utf8",
);

/** Base con la forma de la v38, lista para recibir datos de aquella época. */
function baseV38() {
  const db = new Database(":memory:");
  db.exec(ESQUEMA_V38);
  db.pragma("user_version = 38");
  return db;
}

/** Datos con las columnas que existían en la v38 (nada de lo añadido después). */
function datosV38(db: Database.Database) {
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, city, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("usr_vieja", "Lectora antigua", "vieja@example.test", "scrypt$00$00", "Leipzig", "2025-01-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, city, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("usr_viejo", "Lector viejo", "viejo@example.test", "scrypt$00$00", "Leipzig", "2025-01-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO books (id, title, title_key, author, category, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "bok_viejo",
    "Democracia incómoda",
    "democracia incomoda",
    "Sheldon Wolin",
    "Ficción",
    "2025-01-01T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO listings (id, book_id, owner_id, condition, city, status, search_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "lst_vieja",
    "bok_viejo",
    "usr_vieja",
    "Buen estado",
    "Leipzig",
    "available",
    "democracia incomoda Sheldon Wolin Leipzig",
    "2025-01-01T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO requests (id, listing_id, requester_id, owner_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "req_vieja",
    "lst_vieja",
    "usr_viejo",
    "usr_vieja",
    "pending",
    "2025-01-02T00:00:00.000Z",
    "2025-01-02T00:00:00.000Z",
  );
}

test("una base v38 con datos llega a la versión actual sin perder filas", () => {
  const db = baseV38();
  try {
    datosV38(db);
    migrate(db);

    assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");

    const usuarios = db
      .prepare("SELECT id, name, city, profile_visibility, sign_as, dm_policy FROM users ORDER BY id")
      .all() as Record<string, string>[];
    assert.deepEqual(usuarios, [
      {
        id: "usr_vieja",
        name: "Lectora antigua",
        city: "Leipzig",
        profile_visibility: "members",
        sign_as: "name",
        dm_policy: "mutual",
      },
      {
        id: "usr_viejo",
        name: "Lector viejo",
        city: "Leipzig",
        profile_visibility: "members",
        sign_as: "name",
        dm_policy: "mutual",
      },
    ]);

    const ejemplar = db
      .prepare("SELECT id, owner_id, city, status, search_key FROM listings")
      .get() as Record<string, string>;
    assert.deepEqual(ejemplar, {
      id: "lst_vieja",
      owner_id: "usr_vieja",
      city: "Leipzig",
      status: "available",
      search_key: "democracia incomoda Sheldon Wolin Leipzig",
    });

    const solicitud = db.prepare("SELECT id, status FROM requests").get() as Record<string, string>;
    assert.deepEqual(solicitud, { id: "req_vieja", status: "pending" });

    // El índice FTS de la v46 se construye con lo que ya había: el libro de
    // 2025 se encuentra por prefijo y sin tildes.
    const porTitulo = db
      .prepare("SELECT COUNT(*) AS n FROM books_fts WHERE books_fts MATCH 'democ*'")
      .get() as { n: number };
    assert.equal(porTitulo.n, 1, "books_fts indexa los libros anteriores");
    const porAutor = db
      .prepare("SELECT COUNT(*) AS n FROM books_fts WHERE books_fts MATCH 'wolin'")
      .get() as { n: number };
    assert.equal(porAutor.n, 1);
    const ejemplares = db
      .prepare("SELECT COUNT(*) AS n FROM listings_fts WHERE listings_fts MATCH 'leipzig'")
      .get() as { n: number };
    assert.equal(ejemplares.n, 1, "el índice de ejemplares sigue vivo");
  } finally {
    db.close();
  }
});

test("la actualización crea las tablas e índices que llegaron después", () => {
  const db = baseV38();
  try {
    datosV38(db);
    migrate(db);

    const tablas = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
             ('user_keys','public_key_history','message_envelopes','dm_message_envelopes',
              'social_outbox','social_likes','books_fts')`,
        )
        .all() as { name: string }[]
    ).map((fila) => fila.name);
    assert.deepEqual(tablas.sort(), [
      "books_fts",
      "dm_message_envelopes",
      "message_envelopes",
      "public_key_history",
      "social_likes",
      "social_outbox",
      "user_keys",
    ]);

    const indice = db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'listings_from_request'")
      .get() as { name: string } | undefined;
    assert.ok(indice, "el índice único de la copia recibida existe");

    const columnas = (tabla: string) =>
      (db.pragma(`table_info(${tabla})`) as { name: string }[]).map((columna) => columna.name);
    for (const columna of ["from_listing_id", "from_request_id"]) {
      assert.ok(columnas("listings").includes(columna), `listings.${columna}`);
    }
    for (const columna of ["key_id", "encrypted"]) {
      assert.ok(columnas("messages").includes(columna), `messages.${columna}`);
    }
  } finally {
    db.close();
  }
});

test("volver a migrar una base ya actualizada no toca nada", () => {
  const db = baseV38();
  try {
    datosV38(db);
    migrate(db);
    const antes = db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number };

    migrate(db);

    assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
    assert.deepEqual(db.prepare("SELECT COUNT(*) AS n FROM listings").get(), antes);
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    db.close();
  }
});
