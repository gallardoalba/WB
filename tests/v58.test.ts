/**
 * v58: la cola deja de ser una tabla por cosa.
 *
 * `mail_outbox` tenía el patrón completo —estado, intentos, próximo intento,
 * último error— pero atado al correo, y cada cola nueva copiaba las mismas
 * columnas. La v58 la convierte en `jobs`, con `kind` para distinguir el tipo y
 * `payload` para el contenido.
 *
 * Lo que se fija aquí: los correos que ya estaban en la cola se convierten sin
 * perder ninguno ni su estado —entregado pasa a `done`, fallido a `failed`, «en
 * envío» vuelve a `pending`—, y la tabla vieja desaparece para que no haya dos
 * colas que puedan enviar lo mismo dos veces.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import Database from "better-sqlite3";

import { migrate } from "../src/lib/db/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";

type Db = Database.Database;

/**
 * Una base en la v57, con la cola antigua delante.
 *
 * `migrate()` lleva siempre a la última versión, así que la v57 se reconstruye:
 * se migra del todo y se devuelve la tabla `mail_outbox` a su forma de la v16,
 * que es exactamente lo que hay en una instalación anterior a este escalón.
 */
function databaseAt57(): Db {
  const db = new Database(":memory:");
  migrate(db);
  db.exec(`
    CREATE TABLE mail_outbox (
      id TEXT PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );
  `);
  db.pragma("user_version = 57");
  return db;
}

function insertMail(
  db: Db,
  id: string,
  status: string,
  createdAt: string,
  extra: { attempts?: number; sentAt?: string | null; lastError?: string | null } = {},
): void {
  db.prepare(
    `INSERT INTO mail_outbox
       (id, to_email, subject, body, status, attempts, next_attempt_at, last_error, created_at, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    "lectora@example.test",
    "Confirma tu correo",
    "https://wb.test/verificar?token=abc",
    status,
    extra.attempts ?? 0,
    createdAt,
    extra.lastError ?? null,
    createdAt,
    extra.sentAt ?? null,
  );
}

type JobRow = {
  id: string;
  kind: string;
  target: string | null;
  payload: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
};

test("una base de la v57 convierte la cola de correo en trabajos sin perder filas", () => {
  const db = databaseAt57();
  insertMail(db, "mail_11111111-1111-1111-1111-111111111111", "pending", "2026-01-01T10:00:00.000Z");
  insertMail(db, "mail_22222222-2222-2222-2222-222222222222", "sending", "2026-01-01T11:00:00.000Z", {
    attempts: 1,
  });
  insertMail(db, "mail_33333333-3333-3333-3333-333333333333", "sent", "2026-01-01T12:00:00.000Z", {
    attempts: 1,
    sentAt: "2026-01-01T12:00:05.000Z",
  });
  insertMail(db, "mail_44444444-4444-4444-4444-444444444444", "failed", "2026-01-01T13:00:00.000Z", {
    attempts: 5,
    lastError: "El proveedor no confirmó la entrega.",
  });

  migrate(db);

  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);

  const jobs = db.prepare("SELECT * FROM jobs ORDER BY created_at").all() as JobRow[];
  assert.equal(jobs.length, 4, "no se pierde ningún correo encolado");

  for (const job of jobs) {
    assert.equal(job.kind, "mail");
    assert.equal(job.target, "lectora@example.test", "la dirección sigue siendo consultable");
    assert.match(job.id, /^job_[0-9a-f-]{36}$/);
  }

  const porEstado = Object.fromEntries(jobs.map((job) => [job.id, job.status]));
  assert.equal(porEstado["job_11111111-1111-1111-1111-111111111111"], "pending");
  assert.equal(porEstado["job_22222222-2222-2222-2222-222222222222"], "pending",
    "una reclamación colgada vuelve a la cola");
  assert.equal(porEstado["job_33333333-3333-3333-3333-333333333333"], "done");
  assert.equal(porEstado["job_44444444-4444-4444-4444-444444444444"], "failed");

  const enviado = jobs.find((job) => job.id === "job_33333333-3333-3333-3333-333333333333")!;
  assert.equal(enviado.finished_at, "2026-01-01T12:00:05.000Z", "la fecha de envío se conserva");
  const fallido = jobs.find((job) => job.id === "job_44444444-4444-4444-4444-444444444444")!;
  assert.equal(fallido.attempts, 5);
  assert.match(fallido.last_error ?? "", /no confirmó la entrega/);

  // El contenido viaja en el `payload`, con las claves que espera `processOutbox`.
  const payload = JSON.parse(jobs[0]!.payload) as Record<string, string>;
  assert.deepEqual(Object.keys(payload).sort(), ["subject", "text", "to"]);
  assert.equal(payload.to, "lectora@example.test");
  assert.equal(payload.subject, "Confirma tu correo");

  const tablas = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((row) => row.name);
  assert.equal(tablas.includes("mail_outbox"), false, "no quedan dos colas de correo");
});

test("volver a pasar el escalón no duplica trabajos", () => {
  const db = databaseAt57();
  insertMail(db, "mail_uno", "pending", "2026-01-01T10:00:00.000Z");
  migrate(db);
  const antes = (db.prepare("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count;

  // La marca se retrocede como si el proceso hubiera muerto después de migrar.
  db.pragma("user_version = 57");
  migrate(db);

  const despues = (db.prepare("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count;
  assert.equal(despues, antes);
});

test("una base nueva no arrastra ningún trabajo", () => {
  const db = new Database(":memory:");
  migrate(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count, 0);
});
