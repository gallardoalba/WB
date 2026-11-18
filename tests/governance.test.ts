/**
 * Gobernanza de la instancia: roles, sanciones con motivo y plazo, caducidad y
 * apelaciones revisadas por otra persona.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

import { clearMail, countMailTo, lastMail } from "./mail-queries.ts";

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
  db.prepare("DELETE FROM jobs WHERE kind = 'mail' AND target LIKE '%wanderbibliothek.test'").run();
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

  const mail = lastMail(db, "diego@wanderbibliothek.test");
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

  assert.match(lastMail(db, "diego@wanderbibliothek.test")!.subject, /apelación/i);
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

  const mail = lastMail(db, "lucia@wanderbibliothek.test")!;
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

  assert.match(lastMail(db, "lucia@wanderbibliothek.test")!.body, /suspensión se mantiene/i);
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

  assert.match(lastMail(db, "lucia@wanderbibliothek.test")!.body, /ya había terminado/i);
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

test("pedir un enlace nuevo reenvía la sanción si el primero se perdió", async () => {
  clearSanctions();
  const db = dbModule.getDb();
  const { POST } = await import("../src/app/api/account/appeal-link/route.ts");
  const tokens = await import("../src/lib/account-tokens.ts");

  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_lucia",
    reason: "Enlace perdido",
    days: 5,
  });
  clearMail(db, "lucia@wanderbibliothek.test");

  const response = await POST(
    new Request("http://localhost:3100/api/account/appeal-link", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify({ email: "lucia@wanderbibliothek.test" }),
    }),
  );
  assert.equal(response.status, 200);

  const mail = lastMail(db, "lucia@wanderbibliothek.test");
  assert.ok(mail, "se reenvía el correo con el enlace");
  const token = mail!.body.match(/\/apelar\?token=([a-f0-9]{64})/)![1];
  assert.equal(tokens.consumeAccountToken(token, "appeal"), "usr_lucia");
});

test("pedir un enlace no revela nada ni duplica una apelación abierta", async () => {
  clearSanctions();
  const db = dbModule.getDb();
  const { POST } = await import("../src/app/api/account/appeal-link/route.ts");
  const pedir = (email: string) =>
    POST(
      new Request("http://localhost:3100/api/account/appeal-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify({ email }),
      }),
    );
  const mails = (email: string) => countMailTo(db, email);

  // Cuenta corriente: misma respuesta y ningún correo.
  clearMail(db, "ana@wanderbibliothek.test");
  assert.equal((await pedir("ana@wanderbibliothek.test")).status, 200);
  assert.equal(mails("ana@wanderbibliothek.test"), 0);

  // Con apelación ya abierta tampoco se manda otro enlace.
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_diego",
    reason: "Apelación en curso",
    days: 4,
  });
  repo.createAppeal("usr_diego", "Ya he apelado esta sanción.");
  clearMail(db, "diego@wanderbibliothek.test");
  assert.equal((await pedir("diego@wanderbibliothek.test")).status, 200);
  assert.equal(mails("diego@wanderbibliothek.test"), 0);
  assert.equal(repo.hasOpenAppeal("usr_diego"), true);
});

test("una revisión externa queda registrada con su nombre y no la firma el equipo", () => {
  clearSanctions();
  const db = dbModule.getDb();
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_lucia",
    reason: "Caso para revisión externa",
    days: 8,
  });
  const appealId = repo.createAppeal("usr_lucia", "Pido una segunda mirada.");

  assert.throws(
    () => repo.resolveAppeal("usr_admin2", appealId, "rejected", "Sin nombre.", "X"),
    /quién revisó/i,
  );
  assert.throws(
    () =>
      repo.resolveAppeal("usr_admin", appealId, "rejected", "Intento propio.", "Otra instancia"),
    /otra persona/i,
  );

  repo.resolveAppeal(
    "usr_admin2",
    appealId,
    "rejected",
    "Se mantiene tras revisión externa.",
    "Asamblea de la instancia vecina",
  );

  const row = db
    .prepare("SELECT reviewed_by_kind, reviewed_by_name, reviewer_id FROM appeals WHERE id = ?")
    .get(appealId) as { reviewed_by_kind: string; reviewed_by_name: string; reviewer_id: string };
  assert.equal(row.reviewed_by_kind, "external");
  assert.equal(row.reviewed_by_name, "Asamblea de la instancia vecina");
  assert.equal(row.reviewer_id, "usr_admin2", "quien registra es del equipo");

  const audit = db
    .prepare(
      "SELECT details FROM admin_audit WHERE action = 'appeal_rejected' AND target_id = 'usr_lucia' ORDER BY created_at DESC LIMIT 1",
    )
    .get() as { details: string };
  assert.match(audit.details, /revisión externa: Asamblea de la instancia vecina/);
});

test("un moderador no puede levantar una suspensión por la vía de una apelación", () => {
  const db = dbModule.getDb();
  db.prepare(
    `INSERT OR IGNORE INTO users
       (id, name, email, password_hash, city, bio, is_admin, is_moderator, created_at, locale)
     VALUES (?, ?, ?, ?, ?, '', 0, 1, ?, 'es')`,
  ).run(
    "usr_moderador",
    "Moderación",
    "moderador@wanderbibliothek.test",
    dbModule.DEMO_PASSWORD_HASH,
    "Stuttgart",
    new Date().toISOString(),
  );
  clearSanctions();
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_diego",
    reason: "Sanción que solo administración puede levantar",
    days: 30,
  });
  const appealId = repo.createAppeal("usr_diego", "Quiero una segunda revisión.");

  assert.throws(
    () => repo.resolveAppeal("usr_moderador", appealId, "upheld", "La levanto yo."),
    /Solo la administración/i,
  );
  assert.equal(user("usr_diego")!.is_suspended, 1, "la sanción sigue en pie");

  repo.resolveAppeal("usr_admin2", appealId, "upheld", "La levanta administración.");
  assert.equal(user("usr_diego")!.is_suspended, 0);
  clearSanctions();
});
