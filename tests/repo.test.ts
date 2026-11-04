import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type DbModule = typeof import("../src/lib/db.ts");
type RepoModule = typeof import("../src/lib/repo.ts");
type ThrottleModule = typeof import("../src/lib/throttle.ts");

let dbModule: DbModule;
let repo: RepoModule;
let throttle: ThrottleModule;

before(async () => {
  dbModule = await import("../src/lib/db.ts");
  repo = await import("../src/lib/repo.ts");
  throttle = await import("../src/lib/throttle.ts");
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

test("la búsqueda ignora acentos y filtra por género", () => {
  const found = repo.catalogPage(null, params({ q: "educacion" }));
  assert.equal(found.total, 1);
  assert.equal(found.items[0]?.title, "Una educación");

  const essays = repo.catalogPage(null, params({ category: "Humanidades" }));
  assert.equal(essays.total, 1);
  const biographies = repo.catalogPage(null, params({ category: "Biografías" }));
  assert.equal(biographies.total, 1);
});

test("aceptar una solicitud reserva el ejemplar y expira a los rivales", () => {
  const rival = repo.createRequest("usr_marcos", "lst_1", "Yo también lo quiero");
  assert.equal(rival.status, "pending");

  const accepted = repo.updateRequestStatus("req_seed_2", "usr_clara", "accepted");
  assert.equal(accepted.status, "accepted");
  assert.equal(repo.getListing("lst_1", "usr_clara")?.status, "reserved");

  const requests = repo.listRequests("usr_clara");
  assert.equal(requests.find((item) => item.id === rival.id)?.status, "expired");
});

test("aceptar avisa al solicitante y los avisos se marcan como leídos", () => {
  assert.ok(repo.countUnreadNotifications("usr_diego") >= 1);
  repo.markNotificationsRead("usr_diego");
  assert.equal(repo.countUnreadNotifications("usr_diego"), 0);
});

test("no se puede aceptar sobre un ejemplar ya reservado", () => {
  const db = dbModule.getDb();
  db.prepare(
    "INSERT INTO requests (id, listing_id, requester_id, owner_id, message, status, created_at, updated_at) VALUES (?, ?, ?, ?, '', 'pending', ?, ?)",
  ).run("req_race", "lst_1", "usr_lucia", "usr_clara", new Date().toISOString(), new Date().toISOString());

  assert.throws(
    () => repo.updateRequestStatus("req_race", "usr_clara", "accepted"),
    (error: unknown) => error instanceof Error && error.message.includes("reservado o entregado"),
  );
});

test("un ejemplar pausado no admite nuevas solicitudes", () => {
  repo.setListingStatus("usr_clara", "lst_5", "paused");
  assert.throws(
    () => repo.createRequest("usr_ana", "lst_5", ""),
    (error: unknown) => error instanceof Error && error.message.includes("no está disponible"),
  );
  repo.setListingStatus("usr_clara", "lst_5", "available");
});

test("editar el ejemplar cambia estado, ciudad y notas", () => {
  repo.editListing("usr_clara", "lst_5", {
    condition: "Buen estado",
    city: "Mannheim",
    notes: "Tiene una dedicatoria.",
    tags: ["Firmado"],
  });
  const listing = repo.getListing("lst_5", "usr_clara");
  assert.equal(listing?.condition, "Buen estado");
  assert.equal(listing?.city, "Mannheim");
  assert.equal(listing?.notes, "Tiene una dedicatoria.");
  assert.deepEqual(listing?.tags, ["Firmado"]);
});

test("retirar un ejemplar lo saca del catálogo", () => {
  repo.removeListing("usr_clara", "lst_5");
  assert.equal(repo.getListing("lst_5", "usr_clara"), null);
});

test("bloquear impide iniciar solicitudes entre las dos personas", () => {
  repo.blockUser("usr_ana", "usr_diego");
  assert.throws(
    () => repo.createRequest("usr_ana", "lst_2", ""),
    (error: unknown) => error instanceof Error && error.message.includes("No puedes contactar"),
  );
  repo.unblockUser("usr_ana", "usr_diego");
});

test("las solicitudes antiguas caducan y avisan", () => {
  const db = dbModule.getDb();
  db.prepare(
    "INSERT INTO requests (id, listing_id, requester_id, owner_id, message, status, created_at, updated_at) VALUES (?, ?, ?, ?, '', 'pending', ?, ?)",
  ).run(
    "req_stale",
    "lst_3",
    "usr_marcos",
    "usr_lucia",
    "2020-01-01T00:00:00.000Z",
    "2020-01-01T00:00:00.000Z",
  );

  const expired = repo.expireStaleRequests();
  assert.ok(expired >= 1);
  const request = repo.listRequests("usr_marcos").find((item) => item.id === "req_stale");
  assert.equal(request?.status, "expired");
});

test("una valoración exige un intercambio completado y es única", () => {
  assert.throws(
    () => repo.addReview("req_missing", "usr_ana", 5, "Muy bien"),
    (error: unknown) => error instanceof Error && error.message.includes("no existe"),
  );

  // El cierre es bilateral: la primera confirmación no completa el intercambio.
  repo.updateRequestStatus("req_seed_2", "usr_clara", "completed");
  assert.equal(
    repo.listRequests("usr_diego").find((item) => item.id === "req_seed_2")?.status,
    "accepted",
  );
  const handoverCode = repo
    .listRequests("usr_clara")
    .find((item) => item.id === "req_seed_2")?.handoverCode;
  assert.ok(handoverCode);
  repo.updateRequestStatus("req_seed_2", "usr_diego", "completed", { handoverCode });
  assert.equal(
    repo.listRequests("usr_diego").find((item) => item.id === "req_seed_2")?.status,
    "completed",
  );
  repo.addReview("req_seed_2", "usr_diego", 5, "Todo perfecto");
  assert.throws(
    () => repo.addReview("req_seed_2", "usr_diego", 4, "Otra vez"),
    (error: unknown) => error instanceof Error && error.message.includes("Ya has valorado"),
  );

  const profile = repo.getPublicProfile("usr_clara", null);
  assert.equal(profile?.ratingCount, 1);
  assert.equal(profile?.ratingAverage, 5);
  assert.equal("email" in (profile?.user ?? {}), false);
});

test("administración retira el ejemplar denunciado y deja rastro", () => {
  repo.reportContent({
    reporterId: "usr_ana",
    targetType: "listing",
    targetId: "lst_3",
    reason: "Spam o publicidad",
    details: "Duplicado",
  });

  const [report] = repo.listReports();
  assert.equal(report?.targetId, "lst_3");
  repo.resolveReport("usr_admin", report!.id, "hide_listing");
  assert.equal(repo.getListing("lst_3", null), null);
  assert.equal(repo.listReports().length, 0);
});

test("el limitador corta al superar la cuota", () => {
  const quota = { bucket: "test", key: "probe", limit: 2, windowMs: 60_000 };
  throttle.hit(quota);
  throttle.hit(quota);
  assert.throws(
    () => throttle.hit(quota),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 429,
  );
});

test("exportar datos devuelve la cuenta sin credenciales", () => {
  const data = repo.exportAccountData("usr_ana");
  assert.equal(data.user.id, "usr_ana");
  assert.equal("passwordHash" in data.user, false);
  assert.ok(Array.isArray(data.listings));
  assert.ok(Array.isArray(data.messages));
});

test("eliminar la cuenta anonimiza el usuario y retira sus libros", () => {
  repo.deleteAccount("usr_marcos");
  const user = repo.getUserById("usr_marcos");
  assert.equal(user?.name, "Cuenta eliminada");
  assert.equal(user?.isSuspended, true);
  const listings = repo.catalogPage(null, params({ q: "" }));
  assert.equal(listings.items.some((item) => item.owner.id === "usr_marcos"), false);
});

test("una cuenta suspendida deja de exponer perfil y ejemplares", () => {
  repo.reportContent({
    reporterId: "usr_ana",
    targetType: "user",
    targetId: "usr_diego",
    reason: "Comportamiento abusivo",
    details: "Insistió fuera de la plataforma",
  });
  const report = repo
    .listReports()
    .find((item) => item.targetType === "user" && item.targetId === "usr_diego");
  assert.ok(report);
  repo.resolveReport("usr_admin", report.id, "suspend_user");

  assert.equal(repo.getPublicProfile("usr_diego", null), null);
  assert.equal(repo.getListing("lst_2", null), null);
  const catalog = repo.catalogPage(null, params());
  assert.equal(catalog.items.some((item) => item.owner.id === "usr_diego"), false);
});
