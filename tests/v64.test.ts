/**
 * v64 quita `(AT)` de las ciudades austríacas que no se confunden.
 *
 * La marca se aplicaba a todas y «Wien (AT)» no aclaraba nada. La migración
 * renombra lo ya guardado —perfiles, ejemplares, catálogo y matriz— y conserva
 * la marca solo donde evita una elección equivocada.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import Database from "better-sqlite3";

import { CITIES } from "../src/lib/cities.ts";
import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";
import { normalizeText } from "../src/lib/text.ts";

test("el catálogo solo marca las ciudades austríacas con homónimo alemán", () => {
  const austriacas = ["Bregenz", "Dornbirn", "Eisenstadt", "Feldkirch", "Graz", "Innsbruck",
    "Klagenfurt", "Leoben", "Salzburg", "Steyr", "St. Pölten", "Villach", "Wels", "Wien",
    "Wiener Neustadt"];
  const nombres = new Set(CITIES.map((city) => city.name));
  for (const nombre of austriacas) {
    assert.ok(nombres.has(nombre), `${nombre} debería estar sin marca`);
    assert.equal(nombres.has(`${nombre} (AT)`), false, `${nombre} no necesita la marca`);
  }
  assert.ok(nombres.has("Baden (AT)"), "Baden coincide con Baden-Baden");
  assert.ok(nombres.has("Linz (AT)"), "Linz coincide con Linz am Rhein");
});

test("una base con marcas antiguas se renombra y recalcula la búsqueda", () => {
  const db = new Database(":memory:");
  migrate(db);

  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, city, created_at) VALUES ('usr_1', 'Ada', 'ada@example.test', 'x', 'Wien (AT)', '2026-01-01T00:00:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, city, created_at) VALUES ('usr_2', 'Bea', 'bea@example.test', 'x', 'Baden (AT)', '2026-01-01T00:00:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO books (id, title, title_key, author, isbn, work_key, work_id, category, language, created_at) VALUES ('bok_1', 'El Quijote', 'el quijote', 'Cervantes', NULL, 'quijote', NULL, 'Ficción', 'Español', '2026-01-01T00:00:00.000Z')",
  ).run();
  db.prepare(
    `INSERT INTO listings (id, book_id, owner_id, condition, city, status, search_key, created_at)
     VALUES ('lst_1', 'bok_1', 'usr_1', 'Buen estado', 'Wien (AT)', 'available', ?, '2026-01-01T00:00:00.000Z')`,
  ).run(normalizeText("El Quijote Cervantes Wien (AT)"));
  db.exec(`
    UPDATE cities SET name = 'Wien (AT)' WHERE name = 'Wien';
    UPDATE city_distances SET to_name = 'Wien (AT)' WHERE to_name = 'Wien';
    PRAGMA user_version = 63;
  `);

  migrate(db);

  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.equal(
    (db.prepare("SELECT city FROM users WHERE id = 'usr_1'").get() as { city: string }).city,
    "Wien",
  );
  assert.equal(
    (db.prepare("SELECT city FROM users WHERE id = 'usr_2'").get() as { city: string }).city,
    "Baden (AT)",
    "Baden conserva la marca: también existe en Alemania",
  );
  const listado = db
    .prepare("SELECT city, search_key FROM listings WHERE id = 'lst_1'")
    .get() as { city: string; search_key: string };
  assert.equal(listado.city, "Wien");
  assert.equal(listado.search_key, normalizeText("El Quijote Cervantes Wien"));
  const distancia = db
    .prepare("SELECT km FROM city_distances WHERE from_name = 'München' AND to_name = 'Wien'")
    .get() as { km: number } | undefined;
  assert.ok(
    distancia && distancia.km > 300 && distancia.km < 500,
    "la matriz quedó con el nombre nuevo y su distancia",
  );
  assert.equal(
    db.prepare("SELECT 1 FROM city_distances WHERE to_name = 'Wien (AT)'").get(),
    undefined,
  );

  db.close();
});
