import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type SharedModule = typeof import("../src/lib/repo/shared.ts");

let repo: RepoModule;
let ownerInitials: SharedModule["ownerInitials"];

before(async () => {
  repo = await import("../src/lib/repo.ts");
  ownerInitials = (await import("../src/lib/repo/shared.ts")).ownerInitials;
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

/** «A.» o «A. R.»: iniciales, nunca un nombre completo. */
const SOLO_INICIALES = /^[A-ZÁÉÍÓÚÜÑ]\.( [A-ZÁÉÍÓÚÜÑ]\.)?$/;

test("sin sesión el catálogo no revela quién publica", () => {
  const { items } = repo.catalogPage(null, params());
  assert.ok(items.length > 0, "el catálogo de demostración está vacío");
  for (const item of items) {
    assert.equal(item.owner.masked, true, `«${item.title}» viaja sin enmascarar`);
    // El id abre el perfil, así que tampoco puede viajar.
    assert.equal(item.owner.id, "", `«${item.title}» expone el id de su dueño`);
    assert.match(item.owner.name, SOLO_INICIALES, `«${item.owner.name}» no son iniciales`);
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
});

test("la ficha del ejemplar se enmascara sin sesión y no con ella", () => {
  const first = repo.catalogPage("usr_ana", params()).items[0];
  assert.ok(first, "el catálogo de demostración está vacío");

  const anonymous = repo.getListing(first.id, null);
  assert.ok(anonymous);
  assert.equal(anonymous.owner.masked, true);
  assert.equal(anonymous.owner.id, "");
  assert.match(anonymous.owner.name, SOLO_INICIALES);
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
  }
});

test("las iniciales quedan en la primera y la última palabra del nombre", () => {
  assert.equal(ownerInitials("Ana María Ruiz"), "A. R.");
  assert.equal(ownerInitials("Cristóbal Gallardo"), "C. G.");
  assert.equal(ownerInitials("Beyoncé"), "B.");
  assert.equal(ownerInitials("   "), "?");
});
