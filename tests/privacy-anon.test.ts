import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
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

/** Sin sesión no queda ni un dato que permita reconocer o correlacionar. */
test("sin sesión el catálogo no revela quién publica", () => {
  const { items } = repo.catalogPage(null, params());
  assert.ok(items.length > 0, "el catálogo de demostración está vacío");
  for (const item of items) {
    assert.equal(item.owner.masked, true, `«${item.title}» viaja sin enmascarar`);
    // Ni el id (abre el perfil) ni el nombre ni las iniciales.
    assert.equal(item.owner.id, "", `«${item.title}» expone el id de su dueño`);
    assert.equal(item.owner.name, "", `«${item.title}» expone el nombre de su dueño`);
    // La nota es texto libre: puede llevar un nombre o una dirección.
    assert.equal(item.notes, "", `«${item.title}» expone la nota del anuncio`);
    // Solo el mes: el día exacto se cruza con el aviso público del bot.
    assert.match(item.createdAt, /^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  }
});

test("pedir otra página sin sesión no salta el enmascarado", () => {
  // La paginación es pública (el catálogo se recorre sin cuenta), así que el
  // enmascarado tiene que valer también en la página 2 y siguientes.
  for (const page of [1, 2, 3]) {
    for (const item of repo.catalogPage(null, params({ page })).items) {
      assert.equal(item.owner.masked, true, `«${item.title}» viaja sin enmascarar`);
      assert.equal(item.owner.id, "");
      assert.equal(item.owner.name, "");
      assert.equal(item.notes, "");
    }
  }
});

test("con sesión el catálogo sigue mostrando nombres y perfiles", () => {
  const { items } = repo.catalogPage("usr_ana", params());
  assert.ok(items.length > 0, "el catálogo de demostración está vacío");
  for (const item of items) {
    assert.notEqual(item.owner.masked, true, `«${item.title}» llega enmascarado con sesión`);
    assert.ok(item.owner.id.startsWith("usr_"), `«${item.title}» pierde el enlace al perfil`);
    assert.ok(item.owner.name.trim().length > 0);
  }
  // La fecha vuelve a ser exacta: no todos los ejemplares caen en el día 1.
  assert.ok(items.some((item) => item.createdAt.slice(8, 10) !== "01"));
});

test("la nota del anuncio solo viaja con sesión", () => {
  // Con sesión llega el id real de quien publica, que es lo que hace falta para
  // editar como esa persona.
  const mine = repo.catalogPage("usr_ana", params()).items[0];
  assert.ok(mine, "el catálogo de demostración está vacío");
  repo.editListing(mine.owner.id, mine.id, {
    condition: mine.condition,
    city: mine.city,
    tags: [],
    notes: "Lo dejé a nombre de Ana en el portal 3",
  });
  assert.ok(
    repo.getListing(mine.id, mine.owner.id)?.notes.includes("portal 3"),
    "con sesión la nota se conserva",
  );
  assert.equal(repo.getListing(mine.id, null)?.notes, "");
});

test("la ficha del ejemplar se enmascara sin sesión y no con ella", () => {
  const first = repo.catalogPage("usr_ana", params()).items[0];
  assert.ok(first, "el catálogo de demostración está vacío");

  const anonymous = repo.getListing(first.id, null);
  assert.ok(anonymous);
  assert.equal(anonymous.owner.masked, true);
  assert.equal(anonymous.owner.id, "");
  assert.equal(anonymous.owner.name, "");
  // El resto de la ficha sigue siendo público: lo que se protege es la identidad.
  assert.equal(anonymous.title, first.title);
  assert.equal(anonymous.city, first.city);

  const authenticated = repo.getListing(first.id, "usr_ana");
  assert.ok(authenticated);
  assert.notEqual(authenticated.owner.masked, true);
  assert.equal(authenticated.owner.id, first.owner.id);
  assert.equal(authenticated.owner.name, first.owner.name);
});

test("las sugerencias de la misma categoría también van enmascaradas", () => {
  const first = repo.catalogPage("usr_ana", params()).items[0];
  assert.ok(first, "el catálogo de demostración está vacío");
  for (const item of repo.similarListings(first.bookId, null)) {
    assert.equal(item.owner.masked, true);
    assert.equal(item.owner.id, "");
    assert.equal(item.owner.name, "");
    assert.equal(item.notes, "");
  }
});
