/**
 * Gobernanza de la instancia: roles, sanciones con motivo y plazo, caducidad y
 * apelaciones revisadas por otra persona.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let dbModule: DbModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  dbModule = await import("../src/lib/db/index.ts");
  const db = dbModule.getDb();
  // Segunda administración: la apelación no puede revisarla quien sancionó.
  db.prepare(
    `INSERT OR IGNORE INTO users
       (id, name, email, password_hash, city, bio, is_admin, is_moderator, created_at, locale)
     VALUES (?, ?, ?, ?, ?, '', 1, 0, ?, 'es')`,
  ).run(
    "usr_admin2",
    "Administración segunda",
    "admin2@wanderbibliothek.test",
    dbModule.DEMO_PASSWORD_HASH,
    "Stuttgart",
    new Date().toISOString(),
  );
});

function user(id: string) {
  return dbModule.getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | {
        is_suspended: number;
        suspended_until: string | null;
        suspension_reason: string | null;
      }
    | undefined;
}

function clearSanctions() {
  const db = dbModule.getDb();
  db.prepare("DELETE FROM appeals").run();
  db.prepare("DELETE FROM admin_audit WHERE target_id IN (?, ?)").run("usr_diego", "usr_lucia");
  db.prepare(
    `UPDATE users SET is_suspended = 0, suspended_until = NULL, suspension_reason = NULL
      WHERE id IN (?, ?)`,
  ).run("usr_diego", "usr_lucia");
  db.prepare("DELETE FROM mail_outbox WHERE to_email LIKE '%wanderbibliothek.test'").run();
}

test("moderar y sancionar son permisos distintos", async () => {
  const { canModerate, canSanction } = await import("../src/lib/permissions.ts");
  const moderator = { isAdmin: false, isModerator: true };
  const admin = { isAdmin: true, isModerator: false };
  assert.equal(canModerate(moderator), true);
  assert.equal(canSanction(moderator), false);
  assert.equal(canModerate(admin), true);
  assert.equal(canSanction(admin), true);
});

test("la v52 separa moderación, limita la suspensión y guarda apelaciones", () => {
  const db = dbModule.getDb();
  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
  for (const column of ["is_moderator", "suspended_until", "suspension_reason"]) {
    assert.ok(columns("users").includes(column), `falta users.${column}`);
  }
  for (const column of ["user_id", "audit_id", "sanction_reason", "message", "status", "reviewer_id"]) {
    assert.ok(columns("appeals").includes(column), `falta appeals.${column}`);
  }
});

test("suspender exige motivo y plazo, y avisa con un enlace de apelación", () => {
  clearSanctions();
  const db = dbModule.getDb();

  assert.throws(
    () =>
      repo.moderateTarget("usr_admin", {
        action: "suspend_user",
        targetType: "user",
        targetId: "usr_diego",
      }),
    /motivo/i,
  );
  assert.throws(
    () =>
      repo.moderateTarget("usr_admin", {
        action: "suspend_user",
        targetType: "user",
        targetId: "usr_diego",
        reason: "Acoso reiterado",
      }),
    /días/i,
  );

  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_diego",
    reason: "Acoso reiterado",
    days: 7,
  });

  const suspended = user("usr_diego")!;
  assert.equal(suspended.is_suspended, 1);
  assert.equal(suspended.suspension_reason, "Acoso reiterado");
  assert.ok(
    new Date(suspended.suspended_until!).getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000,
  );

  const audit = db
    .prepare(
      "SELECT details FROM admin_audit WHERE action = 'suspend_user' AND target_id = 'usr_diego' ORDER BY created_at DESC LIMIT 1",
    )
    .get() as { details: string };
  assert.match(audit.details, /motivo: Acoso reiterado/);

  const mail = db
    .prepare("SELECT subject, body FROM mail_outbox WHERE to_email = ? ORDER BY created_at DESC LIMIT 1")
    .get("diego@wanderbibliothek.test") as { subject: string; body: string } | undefined;
  assert.ok(mail, "la sanción avisa por correo");
  assert.match(mail!.body, /\/apelar\?token=[a-f0-9]{64}/);
});

test("una suspensión vencida se levanta y avisa", () => {
  clearSanctions();
  const db = dbModule.getDb();
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_diego",
    reason: "Prueba de caducidad",
    days: 1,
  });
  db.prepare(
    "UPDATE users SET suspended_until = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute') WHERE id = ?",
  ).run("usr_diego");

  const expired = repo.expireDueSuspensions();
  assert.ok(expired.includes("usr_diego"));
  assert.equal(user("usr_diego")!.is_suspended, 0);
  assert.equal(user("usr_diego")!.suspension_reason, null);
});

test("la apelación la revisa otra persona y, si se estima, reactiva la cuenta", () => {
  clearSanctions();
  const db = dbModule.getDb();
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_diego",
    reason: "Decisión discutible",
    days: 30,
  });

  const appealId = repo.createAppeal("usr_diego", "Creo que la sanción se basa en un malentendido.");
  assert.throws(
    () => repo.createAppeal("usr_diego", "Otra apelación para la misma sanción."),
    /apelación abierta/i,
  );

  const ownView = repo.listOpenAppeals("usr_admin").find((appeal) => appeal.id === appealId);
  assert.equal(ownView?.canReview, false, "quien sancionó no puede revisar");
  const otherView = repo.listOpenAppeals("usr_admin2").find((appeal) => appeal.id === appealId);
  assert.equal(otherView?.canReview, true);

  assert.throws(
    () => repo.resolveAppeal("usr_admin", appealId, "upheld", "Se levanta la sanción."),
    /otra persona/i,
  );

  repo.resolveAppeal("usr_admin2", appealId, "upheld", "Se levanta la sanción: fue un malentendido.");
  assert.equal(user("usr_diego")!.is_suspended, 0);
  assert.equal(user("usr_diego")!.suspension_reason, null);

  const resolved = db
    .prepare("SELECT status, reviewer_id, resolution FROM appeals WHERE id = ?")
    .get(appealId) as { status: string; reviewer_id: string; resolution: string };
  assert.equal(resolved.status, "upheld");
  assert.equal(resolved.reviewer_id, "usr_admin2");

  const audit = db
    .prepare(
      "SELECT 1 FROM admin_audit WHERE action = 'appeal_upheld' AND target_id = 'usr_diego'",
    )
    .get();
  assert.ok(audit, "la decisión queda en la auditoría");

  const mail = db
    .prepare("SELECT subject FROM mail_outbox WHERE to_email = ? ORDER BY created_at DESC LIMIT 1")
    .get("diego@wanderbibliothek.test") as { subject: string } | undefined;
  assert.match(mail!.subject, /apelación/i);
});

test("el informe de moderación da cifras agregadas y coherentes", () => {
  const report = repo.moderationReport(30);
  assert.equal(typeof report.reports.open, "number");
  assert.equal(typeof report.suspensions.active, "number");
  assert.equal(report.appeals.open, repo.countOpenAppeals());
  assert.ok(Array.isArray(report.actions));
});

test("el enlace de apelación vale una vez, para apelar y para nadie más", async () => {
  clearSanctions();
  const tokens = await import("../src/lib/account-tokens.ts");
  const db = dbModule.getDb();
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_lucia",
    reason: "Prueba del enlace",
    days: 5,
  });

  const mail = db
    .prepare("SELECT body FROM mail_outbox WHERE to_email = ? ORDER BY rowid DESC LIMIT 1")
    .get("lucia@wanderbibliothek.test") as { body: string };
  const enlace = mail.body.match(/\/apelar\?token=([a-f0-9]{64})/);
  assert.ok(enlace, "el correo trae el enlace de apelación");
  const token = enlace![1];

  // Mirar el enlace desde la página no lo gasta: solo lo consume el envío.
  assert.equal(tokens.peekAccountToken(token, "appeal"), "usr_lucia");
  assert.equal(tokens.peekAccountToken(token, "appeal"), "usr_lucia");
  assert.equal(tokens.consumeAccountToken(token, "reset_password"), null);
  assert.equal(tokens.consumeAccountToken(token, "appeal"), "usr_lucia");
  assert.equal(tokens.consumeAccountToken(token, "appeal"), null);
});

test("sin sanción activa no hay nada que apelar", () => {
  clearSanctions();
  assert.throws(() => repo.createAppeal("usr_lucia", "No procede."), /sanción activa/i);
});

test("una apelación rechazada mantiene la sanción y lo explica", () => {
  clearSanctions();
  const db = dbModule.getDb();
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_lucia",
    reason: "Insultos en una lista",
    days: 10,
  });
  const appealId = repo.createAppeal("usr_lucia", "Fue una discusión, no un insulto.");
  repo.resolveAppeal("usr_admin2", appealId, "rejected", "Se mantiene: hubo insultos.");

  assert.equal(user("usr_lucia")!.is_suspended, 1, "la sanción sigue en pie");
  const audit = db
    .prepare("SELECT 1 FROM admin_audit WHERE action = 'appeal_rejected' AND target_id = 'usr_lucia'")
    .get();
  assert.ok(audit, "el rechazo queda auditado");

  const mail = db
    .prepare("SELECT body FROM mail_outbox WHERE to_email = ? ORDER BY rowid DESC LIMIT 1")
    .get("lucia@wanderbibliothek.test") as { body: string };
  assert.match(mail.body, /suspensión se mantiene/i);
});

test("si la sanción ya venció, el rechazo no la resucita y el correo lo dice", () => {
  clearSanctions();
  const db = dbModule.getDb();
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_lucia",
    reason: "Sanción corta",
    days: 1,
  });
  const appealId = repo.createAppeal("usr_lucia", "Apelo antes de que venza.");
  db.prepare(
    "UPDATE users SET suspended_until = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour') WHERE id = ?",
  ).run("usr_lucia");
  repo.expireDueSuspensions();

  repo.resolveAppeal("usr_admin2", appealId, "rejected", "Se revisó tarde.");
  assert.equal(user("usr_lucia")!.is_suspended, 0, "el rechazo no vuelve a suspender");

  const mail = db
    .prepare("SELECT body FROM mail_outbox WHERE to_email = ? ORDER BY rowid DESC LIMIT 1")
    .get("lucia@wanderbibliothek.test") as { body: string };
  assert.match(mail.body, /ya había terminado/i);
});

test("el mantenimiento borra apelaciones resueltas viejas y conserva las abiertas", () => {
  clearSanctions();
  const db = dbModule.getDb();
  const vieja = (() => {
    repo.moderateTarget("usr_admin", {
      action: "suspend_user",
      targetType: "user",
      targetId: "usr_lucia",
      reason: "Caso viejo",
      days: 3,
    });
    const id = repo.createAppeal("usr_lucia", "Apelación antigua.");
    repo.resolveAppeal("usr_admin2", id, "upheld", "Se estima.");
    db.prepare("UPDATE appeals SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-800 days') WHERE id = ?").run(id);
    return id;
  })();

  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_lucia",
    reason: "Caso abierto",
    days: 5,
  });
  const abierta = repo.createAppeal("usr_lucia", "Todavía sin revisar.");

  repo.runMaintenance();

  const viva = (id: string) =>
    Boolean(db.prepare("SELECT 1 FROM appeals WHERE id = ?").get(id));
  assert.equal(viva(vieja), false, "la resuelta de hace más de dos años se borra");
  assert.equal(viva(abierta), true, "una apelación abierta no se toca");
});
