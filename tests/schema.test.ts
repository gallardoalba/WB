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
  "club_attendance",
  "club_loans",
  "club_members",
  "club_poll_options",
  "club_poll_votes",
  "club_polls",
  "club_post_likes",
  "club_posts",
  "clubs",
  "device_envelopes",
  "device_keys",
  "device_one_time_keys",
  "dm_message_envelopes",
  "dm_messages",
  "dm_reads",
  "dm_threads",
  "events",
  "favorites",
  "follows",
  "jobs",
  "key_snapshots",
  "listing_tags",
  "listings",
  "listings_fts",
  "message_envelopes",
  "messages",
  "notifications",
  "product_events",
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
  "social_likes",
  "social_outbox",
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
  users: ["email", "city", "public_key", "public_key_id", "locale", "email_verified_at", "is_moderator", "suspended_until", "suspension_reason"],
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
  user_keys: ["user_id", "platform", "key_id", "public_jwk"],
  message_envelopes: ["message_id", "key_id", "ciphertext", "iv"],
  dm_message_envelopes: ["message_id", "key_id", "ciphertext", "iv"],
  public_key_history: ["key_id", "platform", "reason", "replaced_at"],
  clubs: ["meets_at", "meets_on", "status", "meets_place", "meets_link"],
  club_posts: ["club_id", "author_id", "parent_id", "body", "status"],
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
  social_outbox: ["network", "subject", "body", "status", "attempts", "media_id", "owner_id", "day"],
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

test("las invariantes de la conexión siguen activas", () => {
  const db = freshDatabase();
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.equal(db.pragma("secure_delete", { simple: true }), 1);
  assert.equal(db.pragma("busy_timeout", { simple: true }), 5000);
  db.close();
});
