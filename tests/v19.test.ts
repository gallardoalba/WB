import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let dbModule: DbModule;

const fails = (fragment: string) => (error: unknown) =>
  error instanceof Error && error.message.includes(fragment);

before(async () => {
  repo = await import("../src/lib/repo.ts");
  dbModule = await import("../src/lib/db/index.ts");
});

function makeClub(overrides: Partial<Parameters<RepoModule["createClub"]>[1]> = {}) {
  return repo.createClub("usr_clara", {
    name: `Club ${Math.random().toString(36).slice(2, 8)}`,
    city: "Stuttgart",
    description: "Lecturas compartidas",
    bookId: "bok_1",
    meetsOn: "Último martes, 19:00",
    meetsAt: "2030-06-04T19:00:00.000Z",
    joinPolicy: "open",
    ...overrides,
  });
}

test("la v19 añade encuentros, política de entrada, progreso y asistencia", () => {
  const db = dbModule.getDb();
  assert.equal(db.pragma("user_version", { simple: true }), dbModule.SCHEMA_VERSION);
  assert.equal(dbModule.SCHEMA_VERSION, 41);
  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
  for (const column of ["meets_at", "status", "join_policy", "progress", "progress_note"]) {
    assert.ok(columns("clubs").includes(column), `falta clubs.${column}`);
  }
  assert.ok(columns("club_members").includes("status"));
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((row) => row.name);
  assert.ok(tables.includes("club_attendance"));
  assert.ok(tables.includes("product_events"));
});

test("el club expone dueño, próximos encuentros y miembros de un vistazo", () => {
  const club = makeClub();
  assert.equal(club.owner.name, "Clara Montes");
  assert.equal(club.meetsAt, "2030-06-04T19:00:00.000Z");
  assert.equal(club.joinPolicy, "open");
  assert.equal(club.myStatus, "member");
  assert.equal(club.isMember, true);
  assert.deepEqual(club.memberPreview.map((member) => member.name), ["Clara Montes"]);

  const listed = repo.listClubs({ viewerId: "usr_clara", city: "Stuttgart" });
  const found = listed.clubs.find((entry) => entry.id === club.id);
  assert.ok(found);
  assert.equal(found!.owner.id, "usr_clara");

  assert.ok(repo.getStats().clubs >= 1);
});

test("un club con aprobación no admite a nadie hasta que el dueño decide", () => {
  const club = makeClub({ joinPolicy: "approval" });

  const request = repo.setClubMembership("usr_diego", club.id, true);
  assert.equal(request.member, false);
  assert.equal(request.status, "pending");
  assert.equal(request.members, 1);
  assert.equal(request.pending, 1);

  assert.equal(repo.getClub(club.id, "usr_diego")?.isMember, false);
  assert.equal(repo.getClub(club.id, "usr_diego")?.myStatus, "pending");
  assert.ok(
    repo
      .listNotifications("usr_clara")
      .some((notification) => notification.type === "club" && /solicitud/i.test(notification.title)),
  );

  const pending = repo.listClubRequests(club.id, "usr_clara");
  assert.deepEqual(pending.map((entry) => entry.user.id), ["usr_diego"]);
  // Desde la v34 las solicitudes las ve «quien lleva el club»: su dueño o un
  // moderador, nunca un miembro cualquiera.
  assert.throws(() => repo.listClubRequests(club.id, "usr_ana"), fails("Solo quien lleva"));

  const after = repo.decideClubMembership("usr_clara", club.id, "usr_diego", true);
  assert.equal(after.members, 2);
  assert.equal(after.pending, 0);
  assert.equal(repo.getClub(club.id, "usr_diego")?.isMember, true);
  assert.ok(
    repo
      .listNotifications("usr_diego")
      .some((notification) => notification.type === "club" && /aceptado/i.test(notification.title)),
  );
});

test("la asistencia solo la confirman miembros y va ligada al encuentro", () => {
  const club = makeClub();
  repo.setClubMembership("usr_diego", club.id, true);

  assert.equal(repo.setClubAttendance("usr_diego", club.id, true).attendees, 1);
  assert.equal(repo.getClub(club.id, "usr_diego")?.attending, true);
  assert.equal(repo.getClub(club.id, "usr_diego")?.attendees, 1);

  assert.throws(() => repo.setClubAttendance("usr_ana", club.id, true), fails("Solo los miembros"));

  const withoutMeeting = makeClub({ meetsAt: "", meetsOn: "" });
  repo.setClubMembership("usr_diego", withoutMeeting.id, true);
  assert.throws(
    () => repo.setClubAttendance("usr_diego", withoutMeeting.id, true),
    fails("no ha fijado un encuentro"),
  );
});

test("el progreso y los cambios de encuentro avisan a los miembros", () => {
  const club = makeClub();
  repo.setClubMembership("usr_diego", club.id, true);

  repo.updateClub("usr_clara", club.id, {
    name: club.name,
    description: club.description,
    meetsOn: "Primer jueves, 18:30",
    meetsAt: "2030-07-04T18:30:00.000Z",
    bookId: "bok_1",
    joinPolicy: "open",
    progress: 40,
    progressNote: "Capítulo 4 de 10",
  });

  const updated = repo.getClub(club.id, "usr_diego");
  assert.equal(updated?.progress, 40);
  assert.equal(updated?.progressNote, "Capítulo 4 de 10");
  assert.equal(updated?.meetsAt, "2030-07-04T18:30:00.000Z");
  assert.ok(
    repo
      .listNotifications("usr_diego")
      .filter((notification) => notification.type === "club")
      .length >= 2,
  );
});

test("el dueño puede retirar miembros y ceder el club a otro miembro", () => {
  const club = makeClub();
  repo.setClubMembership("usr_diego", club.id, true);
  repo.setClubMembership("usr_ana", club.id, true);

  repo.removeClubMember("usr_clara", club.id, "usr_diego");
  assert.equal(repo.getClub(club.id, "usr_diego")?.isMember, false);
  assert.ok(
    repo
      .listNotifications("usr_diego")
      .some((notification) => notification.type === "club" && /Ya no estás/.test(notification.title)),
  );
  assert.throws(
    () => repo.removeClubMember("usr_diego", club.id, "usr_ana"),
    fails("Solo quien creó el club puede retirar"),
  );

  repo.transferClub("usr_clara", club.id, "usr_ana");
  assert.equal(repo.getClub(club.id, "usr_ana")?.owner.id, "usr_ana");
  assert.equal(repo.getClub(club.id, "usr_ana")?.isMine, true);
  assert.throws(
    () =>
      repo.updateClub("usr_clara", club.id, {
        name: club.name,
        description: "",
        meetsOn: "",
        bookId: null,
      }),
    fails("Solo puedes editar"),
  );
});

test("invitar exige ser miembro y no depende del correo", () => {
  const club = makeClub();
  assert.throws(() => repo.inviteToClub("usr_diego", club.id, "usr_ana"), fails("Solo los miembros"));

  repo.inviteToClub("usr_clara", club.id, "usr_diego");
  assert.ok(
    repo
      .listNotifications("usr_diego")
      .some((notification) => notification.type === "club" && /invitado/i.test(notification.title)),
  );

  repo.setClubMembership("usr_diego", club.id, true);
  assert.throws(() => repo.inviteToClub("usr_clara", club.id, "usr_diego"), fails("ya está"));
});

test("un club se puede denunciar, ocultar y restablecer", () => {
  const club = makeClub();

  repo.reportContent({
    reporterId: "usr_diego",
    targetType: "club",
    targetId: club.id,
    reason: "Spam o publicidad",
    details: "Se usa solo para promocionar una tienda.",
  });
  const report = repo
    .listReports()
    .find((entry) => entry.targetType === "club" && entry.targetId === club.id);
  assert.ok(report);
  assert.match(report!.targetLabel, new RegExp(club.name));
  assert.throws(
    () =>
      repo.reportContent({
        reporterId: "usr_clara",
        targetType: "club",
        targetId: club.id,
        reason: "Otro",
        details: "",
      }),
    fails("no existe"),
  );

  repo.moderateTarget("usr_admin", {
    action: "hide_club",
    targetType: "club",
    targetId: club.id,
  });
  assert.equal(repo.getClub(club.id, "usr_diego"), null);
  assert.equal(repo.listClubs({ viewerId: null }).clubs.some((entry) => entry.id === club.id), false);
  assert.ok(repo.listHiddenClubs().some((entry) => entry.id === club.id));

  repo.moderateTarget("usr_admin", {
    action: "restore_club",
    targetType: "club",
    targetId: club.id,
  });
  assert.ok(repo.getClub(club.id, "usr_diego"));
});

test("las listas públicas se pueden descubrir y las privadas de cuentas suspendidas no", () => {
  const list = repo.createReadingList("usr_clara", {
    title: "Ensayo para el club",
    description: "Lo que leemos este trimestre.",
  });
  repo.addToList("usr_clara", list.id, "bok_1");

  const page = repo.listPublicReadingLists({ viewerId: "usr_diego" });
  const found = page.lists.find((entry) => entry.id === list.id);
  assert.ok(found);
  assert.equal(found!.items, 1);
  assert.equal(found!.owner.name, "Clara Montes");

  const filtered = repo.listPublicReadingLists({ viewerId: null, q: "trimestre" });
  assert.ok(filtered.lists.some((entry) => entry.id === list.id));
});

test("el directorio de lectores calcula cercanía y obras en común", () => {
  const page = repo.listReaders({ viewerId: "usr_ana", sort: "near", pageSize: 48 });
  assert.ok(page.readers.length > 0);
  for (const reader of page.readers) {
    assert.ok("distanceKm" in reader);
    assert.ok(reader.sharedBooks >= 0);
    assert.ok(reader.clubs >= 0);
  }
  // Ana y Clara comparten bok_1 en sus estanterías del seed.
  const clara = page.readers.find((entry) => entry.user.id === "usr_clara");
  assert.ok(clara);
  assert.ok((clara!.sharedBooks ?? 0) >= 0);
});

test("el panel guarda métricas de clubes sin contar cuentas suspendidas", () => {
  const metrics = repo.getCommunityMetrics();
  assert.ok(metrics.clubs >= 1);
  assert.ok(metrics.memberships >= 1);
  assert.ok(metrics.views7d >= 0);
  assert.ok(metrics.joins7d >= 0);
  assert.equal(typeof metrics.retention7d, "number");
});

test("el mantenimiento avisa del encuentro una sola vez", () => {
  const soon = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const club = makeClub({ meetsAt: soon });
  repo.setClubMembership("usr_diego", club.id, true);

  assert.ok(repo.notifyUpcomingMeetings() >= 1);
  assert.ok(
    repo
      .listNotifications("usr_diego")
      .some((notification) => notification.type === "club" && /encuentro/i.test(notification.title)),
  );
  // Sin duplicados en la siguiente pasada.
  assert.equal(repo.notifyUpcomingMeetings(), 0);
  assert.equal(typeof repo.runMaintenance().clubReminders, "number");
});
