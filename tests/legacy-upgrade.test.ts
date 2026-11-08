/**
 * Actualización de una instalación antigua: el SQL de `LEGACY_UPGRADE`.
 *
 * Quien tenga el proyecto desde hace meses no reinstala: abre la app y espera
 * que sus libros y sus solicitudes sigan ahí. Ese camino no se ejecutaba en
 * ninguna prueba —todas parten de una base vacía—, así que un error de SQL en
 * la actualización solo se habría visto en la máquina de quien actualiza, y con
 * la base ya modificada.
 *
 * Aquí se ejecuta ese SQL contra las dos tablas con la forma antigua (sin
 * `search_key`) y se comprueba que no se pierde ni una fila. La escalera
 * completa de migraciones necesita un volcado real de una instalación vieja;
 * esto cubre la parte del SQL propio. El paso previo que renombra
 * `neighborhood` a `city` (instalaciones anteriores) va en `migrate`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import Database from "better-sqlite3";

import { LEGACY_UPGRADE } from "../src/lib/db/schema.ts";

const TABLAS_ANTIGUAS = `
  CREATE TABLE users (id TEXT PRIMARY KEY);
  CREATE TABLE books (id TEXT PRIMARY KEY);
  CREATE TABLE listings (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, owner_id TEXT NOT NULL,
    condition TEXT NOT NULL, city TEXT NOT NULL,
    distance_km REAL, status TEXT NOT NULL DEFAULT 'available',
    created_at TEXT NOT NULL
  );
  CREATE TABLE requests (
    id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, requester_id TEXT NOT NULL,
    owner_id TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

test("el SQL de actualización conserva los ejemplares y sus solicitudes", () => {
  const db = new Database(":memory:");
  try {
    db.exec(TABLAS_ANTIGUAS);
    db.prepare("INSERT INTO users (id) VALUES ('usr_1'), ('usr_2')").run();
    db.prepare("INSERT INTO books (id) VALUES ('bok_1')").run();
    db.prepare(
      `INSERT INTO listings (id, book_id, owner_id, condition, city, distance_km, status, created_at)
       VALUES ('lst_vieja', 'bok_1', 'usr_1', 'Buen estado', 'Leipzig', 12.5, 'reserved',
               '2025-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO requests (id, listing_id, requester_id, owner_id, message, status, created_at, updated_at)
       VALUES ('req_vieja', 'lst_vieja', 'usr_2', 'usr_1', 'Hola', 'accepted',
               '2025-01-02T00:00:00.000Z', '2025-01-03T00:00:00.000Z')`,
    ).run();

    db.exec(LEGACY_UPGRADE);

    const columnas = (db.pragma("table_info(listings)") as { name: string }[]).map(
      (columna) => columna.name,
    );
    assert.ok(columnas.includes("search_key"), "la tabla nueva ya tiene search_key");

    const ejemplar = db
      .prepare("SELECT id, condition, city, status, distance_km, created_at, search_key FROM listings")
      .get() as Record<string, unknown>;
    assert.deepEqual(ejemplar, {
      id: "lst_vieja",
      condition: "Buen estado",
      city: "Leipzig",
      status: "reserved",
      distance_km: 12.5,
      created_at: "2025-01-01T00:00:00.000Z",
      // Se rellena después, con `backfillSearchKeys`; aquí llega vacío.
      search_key: "",
    });

    const solicitud = db
      .prepare("SELECT id, message, status, created_at, updated_at FROM requests")
      .get() as Record<string, unknown>;
    assert.deepEqual(solicitud, {
      id: "req_vieja",
      message: "Hola",
      status: "accepted",
      created_at: "2025-01-02T00:00:00.000Z",
      updated_at: "2025-01-03T00:00:00.000Z",
    });
  } finally {
    db.close();
  }
});

test("el SQL de actualización también vale sobre tablas vacías", () => {
  const db = new Database(":memory:");
  try {
    db.exec(TABLAS_ANTIGUAS);
    db.exec(LEGACY_UPGRADE);
    const total = db.prepare("SELECT COUNT(*) AS total FROM listings").get() as { total: number };
    assert.equal(total.total, 0);
  } finally {
    db.close();
  }
});
