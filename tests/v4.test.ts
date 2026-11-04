import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.BOOK2PEER_DB = ":memory:";

type DbModule = typeof import("../src/lib/db.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let dbModule: DbModule;
let repo: RepoModule;

before(async () => {
  dbModule = await import("../src/lib/db.ts");
  repo = await import("../src/lib/repo.ts");
});

const params = (overrides: Partial<Record<string, unknown>> = {}) => ({
  view: "discover" as const,
  q: "",
  category: "Todos",
  language: "Todos" as const,
  sort: "recent" as const,
  radius: 0,
  shelf: "all" as const,
  feed: "all" as const,
  tag: "",
  tab: "conversations" as const,
  scope: "region" as const,
  page: 1,
  ...overrides,
});

test("la búsqueda usa FTS5 y acepta prefijos", () => {
  const exact = repo.catalogPage(null, params({ q: "junco" }));
  assert.equal(exact.total, 1);
  assert.equal(exact.items[0]?.title, "El infinito en un junco");

  const prefix = repo.catalogPage(null, params({ q: "infinit" }));
  assert.equal(prefix.total, 1);

  // Sin acentos y por autor.
  assert.equal(repo.catalogPage(null, params({ q: "educacion" })).total, 1);
  assert.equal(repo.catalogPage(null, params({ q: "vallejo" })).total, 1);
  // Token inexistente: sin resultados, sin error de sintaxis FTS.
  assert.equal(repo.catalogPage(null, params({ q: "zzzqqq" })).total, 0);
});

test("los mensajes se cuentan como no leídos hasta abrir la conversación", () => {
  const request = repo.createRequest("usr_ana", "lst_3", "Me interesa");
  repo.addMessage(request.id, "usr_lucia", "Claro, ¿cuándo te viene bien?");

  assert.equal(repo.countUnreadMessages("usr_ana"), 1);
  const listed = repo.listRequests("usr_ana").find((item) => item.id === request.id);
  assert.equal(listed?.unreadMessages, 1);
  // Quien escribe no se cuenta sus propios mensajes.
  assert.equal(repo.countUnreadMessages("usr_lucia"), 0);

  repo.markRequestRead("usr_ana", request.id);
  assert.equal(repo.countUnreadMessages("usr_ana"), 0);
});

test("suspender oculta sin destruir y reactivar devuelve el ejemplar", () => {
  repo.reportContent({
    reporterId: "usr_clara",
    targetType: "user",
    targetId: "usr_diego",
    reason: "Comportamiento abusivo",
    details: "",
  });
  const report = repo
    .listReports()
    .find((item) => item.targetType === "user" && item.targetId === "usr_diego");
  assert.ok(report);
  repo.resolveReport("usr_admin", report.id, "suspend_user");

  assert.equal(repo.getPublicProfile("usr_diego", null), null);
  assert.equal(repo.getListing("lst_2", null), null);
  // El estado del ejemplar no se toca: la sanción es reversible.
  const raw = dbModule
    .getDb()
    .prepare("SELECT status FROM listings WHERE id = ?")
    .get("lst_2") as { status: string };
  assert.equal(raw.status, "available");

  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: "usr_diego",
  });
  assert.ok(repo.getPublicProfile("usr_diego", null));
  assert.ok(repo.getListing("lst_2", null));
  assert.equal(repo.listSuspendedUsers().length, 0);
});

test("retirar y restablecer un ejemplar queda en la auditoría", () => {
  repo.moderateTarget("usr_admin", {
    action: "hide_listing",
    targetType: "listing",
    targetId: "lst_4",
  });
  assert.equal(repo.getListing("lst_4", null), null);

  repo.moderateTarget("usr_admin", {
    action: "restore_listing",
    targetType: "listing",
    targetId: "lst_4",
  });
  assert.ok(repo.getListing("lst_4", null));

  const audit = repo.listAudit();
  assert.ok(audit.some((entry) => entry.action === "hide_listing" && entry.targetId === "lst_4"));
  assert.ok(audit.some((entry) => entry.action === "restore_listing" && entry.targetId === "lst_4"));
  assert.ok(audit.every((entry) => entry.adminName.length > 0));
});

test("no se puede reactivar una cuenta eliminada ni restablecer lo no retirado", () => {
  repo.deleteAccount("usr_marcos");
  assert.throws(
    () =>
      repo.moderateTarget("usr_admin", {
        action: "unsuspend_user",
        targetType: "user",
        targetId: "usr_marcos",
      }),
    (error: unknown) => error instanceof Error && error.message.includes("eliminó"),
  );
  assert.throws(
    () =>
      repo.moderateTarget("usr_admin", {
        action: "restore_listing",
        targetType: "listing",
        targetId: "lst_3",
      }),
    (error: unknown) => error instanceof Error && error.message.includes("no está retirado"),
  );
});

test("las reseñas de cuentas suspendidas dejan de mostrarse", () => {
  // El sembrado incluye una valoración de Ana a Lucía.
  assert.ok(repo.listReviews("usr_lucia").length >= 1);

  repo.reportContent({
    reporterId: "usr_clara",
    targetType: "user",
    targetId: "usr_ana",
    reason: "Comportamiento abusivo",
    details: "",
  });
  const report = repo.listReports().find((item) => item.targetId === "usr_ana");
  repo.resolveReport("usr_admin", report!.id, "suspend_user");
  assert.equal(repo.listReviews("usr_lucia").length, 0);
});

test("denunciar exige un objetivo real y visible", () => {
  assert.throws(
    () =>
      repo.reportContent({
        reporterId: "usr_clara",
        targetType: "message",
        targetId: "msg_inexistente",
        reason: "Comportamiento abusivo",
        details: "",
      }),
    (error: unknown) => error instanceof Error && error.message.includes("no existe"),
  );
  assert.throws(
    () =>
      repo.reportContent({
        reporterId: "usr_clara",
        targetType: "user",
        targetId: "usr_clara",
        reason: "Otro",
        details: "",
      }),
    (error: unknown) => error instanceof Error,
  );
});

test("el mantenimiento purga avisos leídos antiguos y caduca solicitudes", () => {
  const db = dbModule.getDb();
  db.prepare(
    "INSERT INTO notifications (id, user_id, type, title, body, read_at, created_at) VALUES (?, ?, 'request', 'Viejo', '', ?, ?)",
  ).run("ntf_old", "usr_clara", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");

  const report = repo.runMaintenance();
  assert.ok(report.notifications >= 1);
  const remaining = db.prepare("SELECT 1 FROM notifications WHERE id = 'ntf_old'").get();
  assert.equal(remaining, undefined);
  assert.equal(typeof report.expiredRequests, "number");
});

test("los avisos se paginan con desplazamiento", () => {
  for (let index = 0; index < 30; index += 1) {
    repo.notify({ userId: "usr_lucia", type: "message", title: `Aviso ${index}` });
  }
  const first = repo.listNotifications("usr_lucia", { limit: 25, offset: 0 });
  const second = repo.listNotifications("usr_lucia", { limit: 25, offset: 25 });
  assert.equal(first.length, 25);
  assert.ok(second.length >= 5);
  assert.notEqual(first[0]?.id, second[0]?.id);
});
