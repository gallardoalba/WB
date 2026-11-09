import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

const params = (overrides: Record<string, unknown> = {}) => ({
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

/** Preferencias por defecto = comportamiento anterior. */
const DEFAULT_PRIVACY = {
  profileVisibility: "members",
  cityPrecision: "exact",
  signAs: "name",
  dmPolicy: "mutual",
};

function owner() {
  const first = repo.catalogPage("usr_ana", params()).items[0];
  assert.ok(first, "el catálogo de demostración está vacío");
  return first;
}

test("las preferencias se guardan y se leen con el usuario", () => {
  repo.setUserPrivacy("usr_ana", {
    profileVisibility: "followers",
    cityPrecision: "hidden",
    signAs: "community",
    dmPolicy: "exchanged",
  });
  const user = repo.getUserById("usr_ana");
  assert.ok(user);
  assert.equal(user.profileVisibility, "followers");
  assert.equal(user.cityPrecision, "hidden");
  assert.equal(user.signAs, "community");
  assert.equal(user.dmPolicy, "exchanged");
  repo.setUserPrivacy("usr_ana", DEFAULT_PRIVACY);
});

test("con la ciudad oculta solo la ve quien la publica", () => {
  const listing = owner();
  repo.setUserPrivacy(listing.owner.id, { ...DEFAULT_PRIVACY, cityPrecision: "hidden" });

  assert.equal(repo.getListing(listing.id, "usr_ana")?.city, "");
  assert.equal(repo.getListing(listing.id, listing.owner.id)?.city, listing.city);
  // Y tampoco aparece en el perfil público.
  assert.equal(repo.getPublicProfile(listing.owner.id, "usr_ana")?.user.city, "");

  repo.setUserPrivacy(listing.owner.id, DEFAULT_PRIVACY);
  assert.equal(repo.getListing(listing.id, "usr_ana")?.city, listing.city);
});

test("un perfil «solo yo» queda reservado para el resto", () => {
  repo.setUserPrivacy("usr_diego", { ...DEFAULT_PRIVACY, profileVisibility: "private" });

  const ajeno = repo.getPublicProfile("usr_diego", "usr_ana");
  assert.ok(ajeno);
  assert.equal(ajeno.restricted, true);
  assert.equal(ajeno.listings.length, 0);
  assert.equal(ajeno.user.city, "");
  assert.equal(ajeno.user.bio, "");
  // El nombre se sigue viendo: es lo que permite reconocer a quién se sigue.
  assert.ok(ajeno.user.name.length > 0);

  const propio = repo.getPublicProfile("usr_diego", "usr_diego");
  assert.ok(propio);
  assert.equal(propio.restricted, false);
});

test("«solo a quienes sigo» se abre con el seguimiento", () => {
  repo.setUserPrivacy("usr_lucia", { ...DEFAULT_PRIVACY, profileVisibility: "followers" });

  const antes = repo.getPublicProfile("usr_lucia", "usr_ana");
  assert.ok(antes);
  assert.equal(antes.restricted, true);

  repo.setFollow("usr_ana", "usr_lucia", true);
  const despues = repo.getPublicProfile("usr_lucia", "usr_ana");
  assert.ok(despues);
  assert.equal(despues.restricted, false);
  assert.ok(despues.listings.every((item) => item.owner.name.length > 0));
});

test("firmar como comunidad oculta el nombre en los comentarios", () => {
  const listing = owner();
  repo.setUserPrivacy("usr_diego", { ...DEFAULT_PRIVACY, signAs: "community" });
  const comment = repo.createBookComment({
    bookId: listing.bookId,
    authorId: "usr_diego",
    body: "Un comentario de prueba sobre el libro.",
    spoiler: false,
  });

  const vistos = repo.listBookComments(listing.bookId, { id: "usr_ana", isAdmin: false });
  const ajeno = vistos.comments.find((item) => item.id === comment.id);
  assert.ok(ajeno, "el comentario no aparece en el hilo");
  assert.equal(ajeno.authorAnonymous, true);
  assert.equal(ajeno.author.name, "");
  assert.equal(ajeno.author.id, "");

  // Quien lo escribió sí se reconoce.
  const propios = repo.listBookComments(listing.bookId, { id: "usr_diego", isAdmin: false });
  const mio = propios.comments.find((item) => item.id === comment.id);
  assert.ok(mio);
  assert.equal(mio.authorAnonymous, false);
  assert.ok(mio.author.name.length > 0);

  repo.setUserPrivacy("usr_diego", DEFAULT_PRIVACY);
});

test("los mensajes siguen el ajuste de quien los recibe", () => {
  // Por defecto: seguimiento mutuo.
  assert.equal(repo.canDirectMessage("usr_ana", "usr_marcos"), false);
  repo.setFollow("usr_ana", "usr_marcos", true);
  repo.setFollow("usr_marcos", "usr_ana", true);
  assert.equal(repo.canDirectMessage("usr_ana", "usr_marcos"), true);

  // «Solo tras un intercambio» cierra la puerta aunque haya seguimiento.
  repo.setUserPrivacy("usr_marcos", { ...DEFAULT_PRIVACY, dmPolicy: "exchanged" });
  assert.equal(repo.canDirectMessage("usr_ana", "usr_marcos"), false);

  repo.setUserPrivacy("usr_marcos", { ...DEFAULT_PRIVACY, dmPolicy: "mutual" });
  assert.equal(repo.canDirectMessage("usr_ana", "usr_marcos"), true);
});
