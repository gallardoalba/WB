import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { encryptBackup } from "../scripts/backup-crypto.ts";
import { latestBackup, verifyBackupFile } from "../scripts/verify-backup.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";

const KEY = "ab".repeat(32);
process.env.WANDERBIBLIOTHEK_BACKUP_KEY = KEY;

let dir: string;
let plain: string;
let encrypted: string;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wanderbibliothek-verify-test-"));
  plain = path.join(dir, "wanderbibliothek-copia.db");

  // Lo mínimo para que la copia se parezca a la de verdad: las tablas que la
  // aplicación necesita para arrancar y un par de filas.
  const db = new Database(plain);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE books (id TEXT PRIMARY KEY);
    CREATE TABLE listings (id TEXT PRIMARY KEY);
    CREATE TABLE requests (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('usr_1'), ('usr_2');
    INSERT INTO sessions (id, user_id) VALUES ('ses_1', 'usr_1');
    INSERT INTO books (id) VALUES ('bk_1');
    INSERT INTO listings (id) VALUES ('ls_1');
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
  db.close();

  encrypted = `${plain}.enc`;
  encryptBackup(plain, encrypted);
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("una copia cifrada se descifra, se abre y se cuenta", () => {
  const report = verifyBackupFile(encrypted);
  assert.equal(report.encrypted, true);
  assert.equal(report.integrity, "ok");
  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.equal(report.rows.users, 2);
  assert.equal(report.rows.books, 1);
  assert.deepEqual(report.rows.listings, 1);
});

test("una copia sin cifrar también se puede ensayar", () => {
  const report = verifyBackupFile(plain);
  assert.equal(report.encrypted, false);
  assert.equal(report.rows.users, 2);
});

test("con otra clave la copia no se abre", () => {
  process.env.WANDERBIBLIOTHEK_BACKUP_KEY = "cd".repeat(32);
  try {
    assert.throws(() => verifyBackupFile(encrypted), /authenticate|descifr/i);
  } finally {
    process.env.WANDERBIBLIOTHEK_BACKUP_KEY = KEY;
  }
});

test("una copia modificada no pasa la autenticación", () => {
  const tampered = path.join(dir, "wanderbibliothek-manipulada.db.enc");
  const bytes = readFileSync(encrypted);
  bytes[bytes.length - 1] ^= 0xff;
  writeFileSync(tampered, bytes);
  // AES-GCM autentica: un solo byte cambiado se detecta en vez de dar una base
  // silenciosamente distinta.
  assert.throws(() => verifyBackupFile(tampered), /authenticate|descifr/i);
});

test("un fichero que no es una copia se rechaza con un mensaje claro", () => {
  const ajeno = path.join(dir, "wanderbibliothek-ajena.db.enc");
  writeFileSync(ajeno, "esto no es una copia");
  assert.throws(() => verifyBackupFile(ajeno), /no es una copia cifrada de Wanderbibliothek/);
});

test("una base sin las tablas de la aplicación no vale para restaurar", () => {
  const vacia = path.join(dir, "wanderbibliothek-vacia.db");
  const db = new Database(vacia);
  db.exec("CREATE TABLE otra_cosa (id TEXT); PRAGMA user_version = 51;");
  db.close();
  assert.throws(() => verifyBackupFile(vacia), /faltan tablas: users/);
});

test("se elige la copia más reciente del directorio", () => {
  const cajas = mkdtempSync(path.join(tmpdir(), "wanderbibliothek-rotacion-"));
  try {
    const vieja = path.join(cajas, "wanderbibliothek-2026-01-01T00-00-00-000Z.db.enc");
    const nueva = path.join(cajas, "wanderbibliothek-2026-02-01T00-00-00-000Z.db.enc");
    writeFileSync(vieja, "x");
    writeFileSync(nueva, "x");
    utimesSync(vieja, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    utimesSync(nueva, new Date("2026-02-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));
    // Los ficheros que no son copias se ignoran.
    writeFileSync(path.join(cajas, "notas.txt"), "x");
    assert.equal(latestBackup(cajas), nueva);
  } finally {
    rmSync(cajas, { recursive: true, force: true });
  }
  assert.equal(latestBackup(path.join(dir, "no-existe")), null);
});
