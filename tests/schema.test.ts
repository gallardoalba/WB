import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";

/**
 * Deriva del esquema.
 *
 * Las migraciones son el código de mayor riesgo del proyecto: un cambio se
 * escribe una vez y se ejecuta sobre bases de producción que nadie puede
 * recrear. Estas pruebas fijan el estado final (tablas, columnas e índices)
 * para que cualquier cambio de esquema sea **deliberado** y se vea en el diff,
 * y comprueban que la escalera es idempotente.
 */

/** Inventario esperado: si esto cambia, hay que actualizarlo en el mismo PR. */
const EXPECTED_TABLES = [
  "account_tokens",
  "admin_audit",
  "appeals",
  "auth_attempts",
  "availability_alerts",
  "blocks",
  "book_comment_likes",
  "book_comments",
  "book_wants",
  "books",
  "books_fts",
  "cities",
  "city_distances",
  "device_keys",
  "device_one_time_keys",
  "device_one_time_keys_used",
  "dm_message_envelopes",
  "dm_messages",
  "dm_reads",
  "dm_threads",
  "events",
  "favorites",
  "follows",
  "jobs",
  "key_directory_log",
  "key_snapshots",
  "listing_tags",
  "listings",
  "listings_fts",
  "message_envelopes",
  "messages",
  "metrics_samples",
  "notifications",
  "public_key_history",
  "push_subscriptions",
  "reading_list_items",
  "reading_lists",
  "reading_states",
  "reports",
  "request_archives",
  "request_reads",
  "requests",
  "reviews",
  "sessions",
  "throttle",
  "transparency_snapshots",
  "user_keys",
  "users",
  "works",
] as const;

/** Columnas que más fácil se pierden en una migración mal escrita. */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  books: ["isbn", "language", "work_key", "work_id", "title_key", "cover_url"],
  works: ["key", "title", "author"],
  listings: [
    "book_id",
    "owner_id",
    "condition",
    "city",
    "status",
    "search_key",
    "notes",
    "from_listing_id",
    "from_request_id",
  ],
  requests: ["status", "owner_confirmed_at", "requester_confirmed_at"],
  users: ["email", "city", "public_key", "public_key_id", "locale", "email_verified_at", "is_moderator", "suspended_until", "suspension_reason", "onboarding_checklist_dismissed_at"],
  appeals: [
    "user_id",
    "audit_id",
    "status",
    "message",
    "reviewer_id",
    "resolution",
    "reviewed_by_kind",
    "reviewed_by_name",
  ],
  messages: ["ciphertext", "iv", "encrypted", "key_id"],
  metrics_samples: ["created_at", "payload"],
  user_keys: ["user_id", "platform", "key_id", "public_jwk"],
  message_envelopes: ["message_id", "key_id", "ciphertext", "iv"],
  dm_message_envelopes: ["message_id", "key_id", "ciphertext", "iv"],
  public_key_history: ["key_id", "platform", "reason", "replaced_at"],
  key_directory_log: ["user_id", "slot", "line", "created_at"],
  jobs: [
    "kind",
    "target",
    "payload",
    "status",
    "attempts",
    "next_attempt_at",
    "last_error",
    "created_at",
    "finished_at",
  ],
  transparency_snapshots: [
    "created_at",
    "item_count",
    "merkle_root",
    "payload_hash",
    "previous_root",
    "payload",
    "signature",
    "public_key",
  ],
};

function freshDatabase(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

function inventory(db: Database.Database) {
  const tables = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
  const columns: Record<string, string[]> = {};
  for (const table of tables) {
    columns[table] = (db.pragma(`table_info(${table})`) as { name: string }[]).map(
      (column) => column.name,
    );
  }
  const indexes = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
  return { tables, columns, indexes };
}

test("una base nueva queda en la versión de esquema que espera el código", () => {
  const db = freshDatabase();
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  db.close();
});

test("las tablas son exactamente las esperadas (cambio deliberado o error)", () => {
  const db = freshDatabase();
  assert.deepEqual(inventory(db).tables, [...EXPECTED_TABLES]);
  db.close();
});

/** Columnas que una migración antigua creó y la v61 retira: nadie las lee. */
const RETIRED_COLUMNS: Record<string, string[]> = {
  requests: [
    "handover_office_id",
    "handover_set_at",
    "handover_code",
    "handover_method",
    "ship_kind",
    "ship_number",
    "ship_station",
    "ship_street",
    "ship_postal_code",
    "ship_city",
    "ship_set_at",
  ],
};

test("las columnas retiradas no vuelven por una migración antigua", () => {
  const db = freshDatabase();
  const { columns } = inventory(db);
  for (const [table, retired] of Object.entries(RETIRED_COLUMNS)) {
    for (const column of retired) {
      assert.ok(
        !columns[table]!.includes(column),
        `${table}.${column} se conserva: la v61 debería haberla retirado`,
      );
    }
  }
  db.close();
});

test("las columnas que sostienen las funciones actuales existen", () => {
  const db = freshDatabase();
  const { columns } = inventory(db);
  for (const [table, expected] of Object.entries(REQUIRED_COLUMNS)) {
    assert.ok(columns[table], `falta la tabla ${table}`);
    for (const column of expected) {
      assert.ok(
        columns[table]!.includes(column),
        `falta ${table}.${column}: ¿una migración se perdió por el camino?`,
      );
    }
  }
  db.close();
});

test("los índices que evitan recorrer tablas enteras están declarados", () => {
  const db = freshDatabase();
  const { indexes } = inventory(db);
  for (const index of [
    "books_work_key",
    "listing_tags_tag",
    "listings_book",
    "sessions_user",
    "throttle_lookup",
  ]) {
    assert.ok(indexes.includes(index), `falta el índice ${index}`);
  }
  db.close();
});

test("volver a migrar no cambia nada ni toca los datos", () => {
  const db = freshDatabase();
  db.prepare(
    "INSERT INTO users (id, name, email, city, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    "usr_deriva",
    "Prueba Deriva",
    "deriva@example.test",
    "Stuttgart",
    "scrypt$x$y",
    new Date().toISOString(),
  );
  const before = inventory(db);

  // Fuerza la escalera completa otra vez sobre una base ya migrada.
  db.pragma("user_version = 0");
  migrate(db);

  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.deepEqual(inventory(db), before, "migrar dos veces cambió el esquema");
  const user = db.prepare("SELECT name FROM users WHERE id = ?").get("usr_deriva") as
    | { name: string }
    | undefined;
  assert.equal(user?.name, "Prueba Deriva", "migrar dos veces perdió filas");
  db.close();
});

test("la v66 limpia los huérfanos derivados y respeta el historial", () => {
  // Producción llegó al despliegue con una etiqueta y una entrada del muro
  // apuntando a un ejemplar que ya no existía: `foreign_key_check` las marcaba
  // y con ellas fallaban `db:verify` y `db:restore-drill`.
  const db = new Database(":memory:");
  migrate(db);
  const insertUser = db.prepare(
    "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  insertUser.run("usr_a", "Ana", "ana@example.test", "scrypt$00$00", "2026-01-01T00:00:00.000Z");
  insertUser.run("usr_b", "Bea", "bea@example.test", "scrypt$00$00", "2026-01-01T00:00:00.000Z");
  db.prepare(
    "INSERT INTO books (id, title, title_key, author, category, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("bok_1", "Un libro", "un libro", "Autora", "Ensayo", "2026-01-01T00:00:00.000Z");
  db.prepare(
    "INSERT INTO listings (id, book_id, owner_id, condition, city, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("lst_1", "bok_1", "usr_a", "good", "Stuttgart", "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO listing_tags (listing_id, tag) VALUES (?, ?)").run("lst_1", "Ensayo");
  db.prepare("INSERT INTO favorites (user_id, listing_id, created_at) VALUES (?, ?, ?)").run(
    "usr_b",
    "lst_1",
    "2026-01-01T00:00:00.000Z",
  );
  db.prepare(
    "INSERT INTO events (id, type, actor_id, listing_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run("evt_1", "published", "usr_a", "lst_1", "2026-01-01T00:00:00.000Z");
  db.prepare(
    "INSERT INTO requests (id, listing_id, requester_id, owner_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "req_1",
    "lst_1",
    "usr_b",
    "usr_a",
    "pending",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  );

  // El ejemplar se borra por fuera de la aplicación (que nunca lo hace).
  db.pragma("foreign_keys = OFF");
  db.prepare("DELETE FROM listings WHERE id = ?").run("lst_1");
  db.pragma("foreign_keys = ON");

  db.pragma("user_version = 65");
  migrate(db);

  const cuenta = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  assert.equal(cuenta("SELECT count(*) c FROM listing_tags"), 0, "la etiqueta huérfana sigue ahí");
  assert.equal(cuenta("SELECT count(*) c FROM favorites"), 0, "el favorito huérfano sigue ahí");
  assert.equal(cuenta("SELECT count(*) c FROM events"), 0, "la entrada del muro sigue ahí");
  assert.equal(
    cuenta("SELECT count(*) c FROM requests"),
    1,
    "el intercambio es historial y no se borra",
  );
  db.close();
});

test("las invariantes de la conexión siguen activas", () => {
  const db = freshDatabase();
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.equal(db.pragma("secure_delete", { simple: true }), 1);
  assert.equal(db.pragma("busy_timeout", { simple: true }), 5000);
  db.close();
});

test("la v65 retira los grupos de lectura y sus datos", () => {
  // La migración es destructiva a propósito, así que se prueba sobre una base
  // que *tenía* clubes: se recrea una tabla de la v64, se mete una fila, se
  // migra y se comprueba que no queda ni la tabla ni la denuncia que la
  // apuntaba.
  const db = new Database(":memory:");
  migrate(db);
  // La FK de `reports` apunta a `users`: se crea la cuenta de la prueba.
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run("usr_prueba", "Prueba", "prueba@example.test", "scrypt$00$00", "2026-01-01T00:00:00.000Z");
  const usuario = "usr_prueba";
  db.exec(`
    CREATE TABLE clubs (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO clubs (id, name) VALUES ('clb_viejo', 'Club de antes');
  `);
  db.prepare(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, status, created_at)
     VALUES (?, ?, 'club', 'clb_viejo', 'Spam o publicidad', '', 'open', '2026-01-01T00:00:00.000Z')`,
  ).run("rep_club", usuario);
  db.prepare(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, status, created_at)
     VALUES (?, ?, 'listing', 'lst_1', 'Spam o publicidad', '', 'open', '2026-01-01T00:00:00.000Z')`,
  ).run("rep_listing", usuario);
  // Un aviso que enlazaba al club y otro de un intercambio: solo cae el primero.
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, link, created_at)
     VALUES ('ntf_club', ?, 'club', 'Nuevo encuentro del club', '/clubes/clb_viejo', '2026-01-01T00:00:00.000Z')`,
  ).run(usuario);
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, link, created_at)
     VALUES ('ntf_listing', ?, 'request', 'Nueva solicitud de intercambio', '/intercambios', '2026-01-01T00:00:00.000Z')`,
  ).run(usuario);
  db.pragma("user_version = 64");

  migrate(db);

  const tablas = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((row) => row.name);
  assert.equal(
    tablas.some((nombre) => nombre === "clubs" || nombre.startsWith("club_")),
    false,
    "no queda ninguna tabla de clubes",
  );
  assert.equal(
    tablas.includes("product_events"),
    false,
    "la tabla de contadores de clubes tampoco: no la escribía nadie más",
  );
  const denuncias = (
    db.prepare("SELECT id FROM reports ORDER BY id").all() as { id: string }[]
  ).map((row) => row.id);
  assert.deepEqual(denuncias, ["rep_listing"], "la denuncia de un club se va; la del ejemplar, no");
  const avisos = (
    db.prepare("SELECT id FROM notifications ORDER BY id").all() as { id: string }[]
  ).map((row) => row.id);
  assert.deepEqual(avisos, ["ntf_listing"], "el aviso que enlazaba al club se va; el del intercambio, no");
  db.close();
});
