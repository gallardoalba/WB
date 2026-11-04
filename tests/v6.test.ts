import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.BOOK2PEER_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db.ts");
type TokensModule = typeof import("../src/lib/account-tokens.ts");

let repo: RepoModule;
let dbModule: DbModule;
let tokens: TokensModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  dbModule = await import("../src/lib/db.ts");
  tokens = await import("../src/lib/account-tokens.ts");
});

const params = (overrides: Partial<Record<string, unknown>> = {}) => ({
  view: "discover" as const,
  q: "",
  category: "Todos",
  language: "Todos" as const,
  sort: "near" as const,
  radius: 0,
  shelf: "all" as const,
  feed: "all" as const,
  tag: "",
  tab: "conversations" as const,
  scope: "region" as const,
  page: 1,
  ...overrides,
});

test("la distancia depende de la ciudad de quien mira", () => {
  const anonymous = repo.catalogPage(null, params());
  assert.ok(anonymous.items.every((item) => item.distanceKm === null));

  const fromMalasana = repo.catalogPage("usr_ana", params());
  const fromLavapies = repo.catalogPage("usr_marcos", params());
  assert.ok(fromMalasana.items.every((item) => item.distanceKm !== null));
  // Ordenadas de más cerca a más lejos.
  const distances = fromMalasana.items.map((item) => item.distanceKm ?? 999);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  // El mismo ejemplar queda a distinta distancia según dónde esté quien mira.
  const first = fromMalasana.items[0]!;
  const other = fromLavapies.items.find((item) => item.id === first.id);
  assert.ok(other);
});

test("un ejemplar pausado deja de ser público", () => {
  repo.setListingStatus("usr_clara", "lst_5", "paused");
  assert.equal(repo.getListing("lst_5", null), null);
  assert.ok(repo.getListing("lst_5", "usr_clara"));
  repo.setListingStatus("usr_clara", "lst_5", "available");
});

test("no se puede solicitar ni guardar un ejemplar de una cuenta suspendida", () => {
  repo.reportContent({
    reporterId: "usr_clara",
    targetType: "user",
    targetId: "usr_diego",
    reason: "Comportamiento abusivo",
    details: "",
  });
  const report = repo.listReports().find((item) => item.targetId === "usr_diego");
  repo.resolveReport("usr_admin", report!.id, "suspend_user");

  assert.throws(
    () => repo.createRequest("usr_ana", "lst_2", "Hola"),
    (error: unknown) => error instanceof Error && error.message.includes("ya no existe"),
  );
  assert.throws(
    () => repo.setFavorite("usr_ana", "lst_2", true),
    (error: unknown) => error instanceof Error && error.message.includes("no existe"),
  );

  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: "usr_diego",
  });
});

test("las métricas públicas cuadran con lo que se puede ver", () => {
  const before = repo.getStats().available;
  assert.equal(repo.catalogPage(null, params()).total, before);

  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_lucia",
  });
  const after = repo.getStats().available;
  assert.equal(after, before - 1);
  assert.equal(repo.catalogPage(null, params()).total, after);

  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: "usr_lucia",
  });
});

test("la media no cuenta reseñas de cuentas suspendidas", () => {
  const before = repo.getPublicProfile("usr_lucia", null);
  assert.equal(before?.ratingCount, 1);

  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_ana",
  });
  const hidden = repo.getPublicProfile("usr_lucia", null);
  assert.equal(hidden?.ratingCount, 0);
  assert.equal(hidden?.ratingAverage, null);
  assert.equal(repo.listReviews("usr_lucia").length, 0);

  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: "usr_ana",
  });
  assert.equal(repo.getPublicProfile("usr_lucia", null)?.ratingCount, 1);
});

test("el perfil público se pagina", () => {
  repo.createListing("usr_ana", {
    title: "Libro de prueba",
    author: "Autora",
    category: "Humanidades",
    condition: "Buen estado",
    isbn: null,
    city: "Stuttgart",
    tags: [],
  });
  const page = repo.getPublicProfile("usr_ana", null, { page: 1, pageSize: 1 });
  assert.equal(page?.listings.length, 1);
  assert.equal(page?.listingsTotal, 1);
  assert.equal(page?.hasMoreListings, false);
});

test("los tokens de cuenta son de un solo uso y caducan", () => {
  const raw = tokens.issueAccountToken("usr_ana", "verify_email");
  assert.equal(tokens.consumeAccountToken(raw, "verify_email"), "usr_ana");
  assert.equal(tokens.consumeAccountToken(raw, "verify_email"), null);

  const other = tokens.issueAccountToken("usr_ana", "reset_password");
  const db = dbModule.getDb();
  db.prepare("UPDATE account_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE purpose = ?").run(
    "reset_password",
  );
  assert.equal(tokens.consumeAccountToken(other, "reset_password"), null);
});

test("confirmar el correo deja la cuenta verificada", () => {
  const db = dbModule.getDb();
  db.prepare("UPDATE users SET email_verified_at = NULL WHERE id = 'usr_ana'").run();
  assert.equal(repo.getUserById("usr_ana")?.emailVerified, false);

  repo.markEmailVerified("usr_ana");
  assert.equal(repo.getUserById("usr_ana")?.emailVerified, true);
  // Idempotente: no cambia la fecha ya guardada.
  const first = db.prepare("SELECT email_verified_at FROM users WHERE id = 'usr_ana'").get() as {
    email_verified_at: string;
  };
  repo.markEmailVerified("usr_ana");
  const second = db.prepare("SELECT email_verified_at FROM users WHERE id = 'usr_ana'").get() as {
    email_verified_at: string;
  };
  assert.equal(first.email_verified_at, second.email_verified_at);
});
