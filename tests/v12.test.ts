import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

const fails = (pattern: string) => (error: unknown) =>
  error instanceof Error && error.message.includes(pattern);

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

test("los bloqueos también ocultan listas y clubs", () => {
  const list = repo.createReadingList("usr_diego", { title: "Mis pendientes", description: "" });
  repo.addToList("usr_diego", list.id, "bok_1");
  const club = repo.createClub("usr_diego", {
    name: "Club de Mannheim",
    city: "Mannheim",
    description: "",
    meetsOn: "",
  });

  // Antes del bloqueo, Clara ve ambas cosas.
  assert.equal(repo.listReadingLists("usr_diego", "usr_clara").length, 1);
  assert.ok(repo.getClub(club.id, "usr_clara"));

  repo.blockUser("usr_clara", "usr_diego");
  assert.equal(repo.listReadingLists("usr_diego", "usr_clara").length, 0);
  assert.equal(repo.getReadingList(list.id, "usr_clara"), null);
  assert.equal(
    repo.listClubs({ viewerId: "usr_clara" }).clubs.some((item) => item.id === club.id),
    false,
  );
  assert.equal(repo.getClub(club.id, "usr_clara"), null);
  // Quien no está bloqueado sigue viéndolo.
  assert.equal(repo.listReadingLists("usr_diego", "usr_ana").length, 1);
});

test("la exportación incluye la capa social y el recorrido", () => {
  const data = repo.exportAccountData("usr_ana") as Record<string, unknown>;
  for (const key of [
    "comments",
    "commentLikes",
    "following",
    "followers",
    "readingLists",
    "readingListItems",
    "clubsOwned",
    "clubMemberships",
    "clubPosts",
    "directThreads",
    "directMessages",
    "directEnvelopes",
    "journey",
  ]) {
    assert.ok(key in data, `falta ${key} en la exportación`);
  }
  assert.ok(Array.isArray(data.following));
  // La portabilidad tiene que cubrir también la mensajería directa y los
  // mensajes de club, que se quedaban fuera.
  assert.ok(Array.isArray(data.directMessages));
  assert.ok(Array.isArray(data.clubPosts));
});

test("borrar la cuenta elimina el contenido personal y deja hueco en los hilos", () => {
  const root = repo.createBookComment({
    bookId: "bok_4",
    authorId: "usr_clara",
    body: "Comentario de Clara que tiene respuesta y debe quedar como hueco.",
    spoiler: false,
  });
  repo.createBookComment({
    bookId: "bok_4",
    authorId: "usr_ana",
    body: "Respuesta de Ana que no debe desaparecer.",
    spoiler: false,
    parentId: root.id,
  });
  const solo = repo.createBookComment({
    bookId: "bok_5",
    authorId: "usr_clara",
    body: "Comentario sin respuestas que debe borrarse del todo.",
    spoiler: false,
  });
  const list = repo.createReadingList("usr_clara", { title: "Lista que se borra", description: "" });

  repo.deleteAccount("usr_clara");

  const thread = repo.listBookComments("bok_4", null);
  const tombstone = thread.comments.find((item) => item.id === root.id);
  assert.ok(tombstone, "el comentario con respuestas sigue como hueco");
  assert.equal(tombstone!.deleted, true);
  assert.equal(tombstone!.body, "");
  assert.equal(tombstone!.replies.length, 1);

  assert.equal(
    repo.listBookComments("bok_5", null).comments.some((item) => item.id === solo.id),
    false,
  );
  assert.equal(repo.getReadingList(list.id, null), null);
  assert.equal(repo.getFollowState("usr_ana", null).following >= 0, true);
  // Ya no aparece en el directorio ni se puede seguir.
  assert.throws(() => repo.setFollow("usr_ana", "usr_clara", true), fails("no existe"));
});

test("seguidores y seguidos se listan con la misma ficha que el directorio", () => {
  repo.setFollow("usr_marcos", "usr_ana", true);
  repo.setFollow("usr_ana", "usr_lucia", true);

  const followers = repo.listFollowEdges("usr_ana", "followers", "usr_ana");
  assert.ok(followers.some((item) => item.user.id === "usr_marcos"));
  assert.ok(followers.every((item) => item.user.id !== "usr_ana"));

  const following = repo.listFollowEdges("usr_ana", "following", "usr_ana");
  assert.ok(following.some((item) => item.user.id === "usr_lucia"));
  assert.ok(following.every((item) => item.published >= 0));
});

test("el directorio incluye a quien participa aunque no tenga ejemplares", () => {
  const nuevo = repo.createUser({
    name: "Nueva Lectora",
    email: "nueva@wanderbibliothek.test",
    passwordHash: "x",
    city: "Ulm",
  });
  assert.equal(
    repo.listReaders({ viewerId: "usr_ana" }).readers.some((item) => item.user.id === nuevo.id),
    false,
  );
  repo.createBookComment({
    bookId: "bok_1",
    authorId: nuevo.id,
    body: "Mi primer comentario sin haber publicado ningún ejemplar.",
    spoiler: false,
  });
  assert.equal(
    repo.listReaders({ viewerId: "usr_ana" }).readers.some((item) => item.user.id === nuevo.id),
    true,
  );
});

test("el texto de un spoiler se pide aparte y respeta la visibilidad", () => {
  const spoiler = repo.createBookComment({
    bookId: "bok_3",
    authorId: "usr_diego",
    body: "El final se resuelve en la última página: spoiler de verdad.",
    spoiler: true,
  });
  const thread = repo.listBookComments("bok_3", null);
  const visible = thread.comments.find((item) => item.id === spoiler.id);
  assert.ok(visible);
  assert.equal(visible!.spoiler, true);
  assert.equal(visible!.body, "", "el hilo no debe llevar el texto del spoiler");

  assert.match(repo.getCommentBody(spoiler.id, null), /última página/);

  // Oculto por moderación: solo su autor puede leerlo.
  repo.moderateTarget("usr_admin", {
    action: "hide_comment",
    targetType: "comment",
    targetId: spoiler.id,
  });
  assert.throws(() => repo.getCommentBody(spoiler.id, "usr_ana"), fails("no existe"));
  assert.match(repo.getCommentBody(spoiler.id, "usr_diego"), /última página/);
});

test("listas y clubs se pueden editar y cerrar", () => {
  const list = repo.createReadingList("usr_ana", { title: "Título viejo", description: "" });
  repo.updateReadingList("usr_ana", list.id, { title: "Título nuevo", description: "Con nota" });
  assert.equal(repo.getReadingList(list.id, "usr_ana")!.title, "Título nuevo");
  assert.throws(
    () => repo.updateReadingList("usr_diego", list.id, { title: "Robado", description: "" }),
    fails("tus listas"),
  );

  repo.addToList("usr_ana", list.id, "bok_1");
  repo.removeFromList("usr_ana", list.id, "bok_1");
  assert.equal(repo.getReadingList(list.id, "usr_ana")!.items, 0);

  const club = repo.createClub("usr_ana", {
    name: "Club editable",
    city: "Stuttgart",
    description: "",
    bookId: "bok_1",
    meetsOn: "",
  });
  repo.setClubMembership("usr_diego", club.id, true);
  assert.equal(repo.listClubMembers(club.id).members.length, 2);

  repo.updateClub("usr_ana", club.id, {
    name: "Club renombrado",
    description: "Ahora con descripción",
    meetsOn: "Jueves",
    bookId: "bok_2",
  });
  const updated = repo.getClub(club.id, "usr_ana")!;
  assert.equal(updated.name, "Club renombrado");
  assert.equal(updated.book?.id, "bok_2");
  assert.throws(
    () =>
      repo.updateClub("usr_diego", club.id, {
        name: "Otro",
        description: "",
        meetsOn: "",
        bookId: null,
      }),
    fails("tus clubes"),
  );

  repo.deleteClub("usr_ana", club.id);
  assert.equal(repo.getClub(club.id, "usr_ana"), null);
  assert.equal(repo.listClubs({ viewerId: null }).clubs.some((item) => item.id === club.id), false);
});

test("el filtro por etiqueta convive con el resto del catálogo", () => {
  const listing = repo.createListing("usr_ana", {
    title: "Etiquetas y filtros",
    author: "Prueba",
    category: "Humanidades",
    condition: "Buen estado",
    isbn: null,
    city: "Stuttgart",
    tags: ["Historia"],
  });
  assert.equal(repo.catalogPage("usr_ana", params({ tag: "Historia" })).total, 1);
  assert.equal(repo.catalogPage("usr_ana", params({ tag: "Historia", q: "inexistente" })).total, 0);
  assert.deepEqual(repo.getListing(listing.id, "usr_ana")?.tags, ["Historia"]);
});
