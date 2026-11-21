import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import Database from "better-sqlite3";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";
import { encryptBackup } from "../scripts/backup-crypto.ts";
import { runRestoreDrill } from "../scripts/restore-drill.ts";

const root = mkdtempSync(path.join(tmpdir(), "wanderbibliothek-drill-test-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** Base con esquema completo, una cuenta y la versión que se le pida. */
async function seeded(file: string, version = SCHEMA_VERSION): Promise<void> {
  const db = new Database(file);
  migrate(db);
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, city, bio, created_at, locale) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    "usr_drill",
    "Ana",
    "ana@example.test",
    "scrypt$prueba",
    "Stuttgart",
    "",
    "2026-01-01T00:00:00Z",
    "es",
  );
  db.pragma(`user_version = ${version}`);
  db.close();
}

async function backupTo(source: string, target: string): Promise<void> {
  const db = new Database(source, { readonly: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
}

test("una copia cifrada se restaura en un directorio vacío", async () => {
  process.env.WANDERBIBLIOTHEK_BACKUP_KEY = randomBytes(32).toString("hex");
  const live = path.join(root, "viva.db");
  await seeded(live);
  const plain = path.join(root, "copia.db");
  await backupTo(live, plain);
  const encrypted = path.join(root, "copia.db.enc");
  encryptBackup(plain, encrypted);

  const target = path.join(root, "instalacion");
  const report = runRestoreDrill({ backup: encrypted, targetDir: target });

  assert.equal(report.integrity, "ok");
  assert.equal(report.schemaAfter, SCHEMA_VERSION);
  assert.equal(report.rows.users, 1);
  assert.ok(existsSync(path.join(target, "wanderbibliothek.db")));
});

test("una copia de esquema más nuevo se rechaza en vez de degradarla", async () => {
  process.env.WANDERBIBLIOTHEK_BACKUP_KEY = randomBytes(32).toString("hex");
  const live = path.join(root, "futura.db");
  await seeded(live, SCHEMA_VERSION + 1);
  const plain = path.join(root, "futura-copia.db");
  await backupTo(live, plain);

  assert.throws(
    () => runRestoreDrill({ backup: plain }),
    /esquema v\d+ y este código entiende hasta v\d+/,
  );
});
