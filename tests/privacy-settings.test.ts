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

test("la ciudad oculta no se revela en una solicitud pendiente", () => {
  // Diego pide el libro de Clara (`req_seed_2`, pendiente). Con la ciudad
  // oculta, Clara no debe ver dónde está Diego hasta aceptar el intercambio.
  repo.setUserPrivacy("usr_diego", { ...DEFAULT_PRIVACY, cityPrecision: "hidden" });

  const pendiente = repo.getRequest("req_seed_2", "usr_clara");
  assert.ok(pendiente);
  assert.equal(pendiente.requester.city, "", "la ciudad no puede verse antes de aceptar");
  assert.equal(pendiente.owner.city, "Stuttgart", "quien publica sí ve la suya");

  // Quien la publicó la sigue viendo siempre.
  assert.equal(repo.getRequest("req_seed_2", "usr_diego")?.requester.city, "Mannheim");

  repo.updateRequestStatus("req_seed_2", "usr_clara", "accepted");
  const aceptada = repo.getRequest("req_seed_2", "usr_clara");
  assert.equal(aceptada?.requester.city, "Mannheim", "sin ciudad no se puede quedar");

  repo.setUserPrivacy("usr_diego", DEFAULT_PRIVACY);
});

test("una lista anónima no publica quién la firma", () => {
  const list = repo.createReadingList("usr_ana", {
    title: "Lista sin firma",
    description: "",
    showOwner: false,
  });

  // Sin sesión no se recibe el nombre ni el id; con sesión se sigue viendo,
  // que es lo que ya hacía la página.
  assert.deepEqual(repo.getReadingList(list.id, null)?.owner, { id: "", name: "" });
  assert.deepEqual(repo.getReadingList(list.id, "usr_diego")?.owner, {
    id: "usr_ana",
    name: "Ana Martínez",
  });
  assert.deepEqual(repo.getReadingList(list.id, "usr_ana")?.owner, {
    id: "usr_ana",
    name: "Ana Martínez",
  });

  // Si se firma, vuelve a verse también sin sesión.
  repo.updateReadingList("usr_ana", list.id, {
    title: "Lista firmada",
    description: "",
    showOwner: true,
  });
  assert.equal(repo.getReadingList(list.id, null)?.owner.name, "Ana Martínez");
});

test("el directorio respeta la visibilidad del perfil", () => {
  const viewers = (viewerId: string) => repo.listReaders({ viewerId });
  repo.setFollow("usr_ana", "usr_lucia", false);

  // «Solo yo»: no aparece en el directorio.
  repo.setUserPrivacy("usr_lucia", { ...DEFAULT_PRIVACY, profileVisibility: "private" });
  assert.equal(
    viewers("usr_ana").readers.some((reader) => reader.user.id === "usr_lucia"),
    false,
  );

  // «Solo a quienes sigo»: aparece con el nombre (reconocer a quién sigues) pero
  // sin biografía hasta que hay seguimiento.
  repo.setUserPrivacy("usr_lucia", { ...DEFAULT_PRIVACY, profileVisibility: "followers" });
  const sinSeguir = viewers("usr_ana").readers.find((reader) => reader.user.id === "usr_lucia");
  assert.ok(sinSeguir);
  assert.equal(sinSeguir.user.name, "Lucía Prieto");
  assert.equal(sinSeguir.user.bio, "");

  repo.setFollow("usr_ana", "usr_lucia", true);
  const siguiendo = viewers("usr_ana").readers.find((reader) => reader.user.id === "usr_lucia");
  assert.equal(siguiendo?.user.bio, "Novela contemporánea.");

  repo.setFollow("usr_ana", "usr_lucia", false);
  repo.setUserPrivacy("usr_lucia", DEFAULT_PRIVACY);
});

test("la ciudad oculta tampoco se filtra en las listas de seguidores", () => {
  repo.setFollow("usr_diego", "usr_ana", true);
  repo.setUserPrivacy("usr_diego", { ...DEFAULT_PRIVACY, cityPrecision: "hidden" });

  const followEdges = repo.listFollowEdges("usr_ana", "followers", "usr_clara");
  const diego = followEdges.find((entry) => entry.user.id === "usr_diego");
  assert.ok(diego, "Diego debería aparecer como seguidor");
  assert.equal(diego.user.city, "");

  repo.setUserPrivacy("usr_diego", DEFAULT_PRIVACY);
  repo.setFollow("usr_diego", "usr_ana", false);
});

test("el hilo directo no revela una ciudad oculta", () => {
  repo.setUserPrivacy("usr_diego", { ...DEFAULT_PRIVACY, cityPrecision: "hidden" });
  repo.setFollow("usr_ana", "usr_diego", true);
  repo.setFollow("usr_diego", "usr_ana", true);

  assert.equal(repo.directThread("usr_ana", "usr_diego").peer.city, "");

  repo.setFollow("usr_ana", "usr_diego", false);
  repo.setFollow("usr_diego", "usr_ana", false);
  repo.setUserPrivacy("usr_diego", DEFAULT_PRIVACY);
});
