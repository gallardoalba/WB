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

const isStatus = (status: number) => (error: unknown) =>
  error instanceof Error && "status" in error && (error as { status: number }).status === status;

test("solo el dueño cede el club y solo a un miembro activo", () => {
  const club = repo.createClub("usr_clara", {
    name: "Club para ceder",
    city: "Stuttgart",
    description: "",
    meetsOn: "",
    joinPolicy: "open",
  });
  repo.setClubMembership("usr_ana", club.id, true);

  assert.throws(() => repo.transferClub("usr_ana", club.id, "usr_clara"), isStatus(403));
  assert.throws(() => repo.transferClub("usr_clara", club.id, "usr_marcos"), isStatus(409));

  // Una cuenta suspendida no puede quedar al frente: el club desaparecería.
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_ana",
  });
  assert.throws(() => repo.transferClub("usr_clara", club.id, "usr_ana"), isStatus(404));
  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: "usr_ana",
  });

  // Un bloqueo entre las partes también lo impide.
  repo.blockUser("usr_clara", "usr_ana");
  assert.throws(() => repo.transferClub("usr_clara", club.id, "usr_ana"), isStatus(409));
  repo.unblockUser("usr_clara", "usr_ana");

  repo.transferClub("usr_clara", club.id, "usr_ana");
  assert.equal(repo.getClub(club.id, "usr_ana")?.isMine, true);
  assert.equal(repo.getClub(club.id, "usr_clara")?.isMine, false);
});

test("aceptar dos veces la misma solicitud no duplica el alta", () => {
  const club = repo.createClub("usr_clara", {
    name: "Club con aprobación",
    city: "Stuttgart",
    description: "",
    meetsOn: "",
    joinPolicy: "approval",
  });
  const joined = repo.setClubMembership("usr_marcos", club.id, true);
  assert.equal(joined.status, "pending");
  // Repetir la petición no falla ni crea otra fila.
  assert.equal(repo.setClubMembership("usr_marcos", club.id, true).status, "pending");

  const after = repo.decideClubMembership("usr_clara", club.id, "usr_marcos", true);
  assert.equal(after.members, 2);
  assert.throws(
    () => repo.decideClubMembership("usr_clara", club.id, "usr_marcos", true),
    isStatus(404),
  );
  assert.throws(
    () => repo.decideClubMembership("usr_clara", club.id, "usr_marcos", false),
    isStatus(404),
  );
  assert.equal(repo.getClub(club.id, "usr_marcos")?.members, 2);
});

test("unirse sin aprobación es idempotente y no duplica eventos de alta", () => {
  const club = repo.createClub("usr_clara", {
    name: "Club abierto",
    city: "Stuttgart",
    description: "",
    meetsOn: "",
    joinPolicy: "open",
  });
  assert.equal(repo.setClubMembership("usr_marcos", club.id, true).status, "member");
  assert.equal(repo.setClubMembership("usr_marcos", club.id, true).status, "member");
  assert.equal(repo.getClub(club.id, "usr_marcos")?.members, 2);
  const joins = dbModule
    .getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM product_events WHERE type = 'club_join' AND user_id = ? AND club_id = ?",
    )
    .get("usr_marcos", club.id) as { n: number };
  assert.equal(joins.n, 1, "un alta repetida no debe duplicar el evento");
  // Salir y volver a entrar sigue funcionando.
  assert.equal(repo.setClubMembership("usr_marcos", club.id, false).status, "none");
});

test("una denuncia solo se resuelve una vez", () => {
  repo.reportContent({
    reporterId: "usr_ana",
    targetType: "listing",
    targetId: "lst_2",
    reason: "Spam o publicidad",
    details: "Prueba de la auditoría.",
  });
  const [report] = repo.listReports({ limit: 1, offset: 0 });
  assert.ok(report, "se acaba de crear la denuncia");

  repo.resolveReport("usr_admin", report!.id, "dismiss");
  assert.throws(
    () => repo.resolveReport("usr_admin", report!.id, "dismiss"),
    isStatus(409),
  );
});
