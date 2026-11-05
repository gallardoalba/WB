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

test("las etiquetas se guardan, se reemplazan y filtran el catálogo", () => {
  const listing = repo.createListing("usr_ana", {
    title: "Saga de detectives del Neckar",
    author: "Prueba Etiquetas",
    category: "Ficción",
    condition: "Buen estado",
    isbn: null,
    city: "Stuttgart",
    tags: ["Narrativa", "Clásicos"],
  });
  assert.deepEqual([...listing.tags].sort(), ["Clásicos", "Narrativa"]);

  const filtered = repo.catalogPage("usr_ana", params({ tag: "Narrativa" }));
  assert.ok(filtered.items.length >= 1);
  assert.ok(filtered.items.every((item) => item.tags.includes("Narrativa")));
  // Una etiqueta que nadie usa deja el catálogo vacío, no lo rompe.
  assert.equal(repo.catalogPage("usr_ana", params({ tag: "Astronomía" })).total, 0);

  repo.editListing("usr_ana", listing.id, {
    condition: "Buen estado",
    city: "Stuttgart",
    notes: "",
    tags: ["Teatro"],
  });
  assert.deepEqual(repo.getListing(listing.id, "usr_ana")?.tags, ["Teatro"]);
  assert.equal(repo.catalogPage("usr_ana", params({ tag: "Narrativa" })).total, 0);
});

test("una lista de lectura agrupa obras y solo la edita quien la creó", () => {
  const list = repo.createReadingList("usr_ana", {
    title: "Mi top de otoño",
    description: "Lecturas para las tardes de lluvia.",
  });
  assert.equal(list.items, 0);
  assert.equal(list.isMine, true);

  repo.addToList("usr_ana", list.id, "bok_1");
  repo.addToList("usr_ana", list.id, "bok_2");
  repo.addToList("usr_ana", list.id, "bok_2"); // idempotente

  const detail = repo.getReadingList(list.id, "usr_ana");
  assert.ok(detail);
  assert.equal(detail!.items, 2);
  assert.deepEqual(
    detail!.books.map((book) => book.bookId),
    ["bok_1", "bok_2"],
  );

  assert.throws(() => repo.addToList("usr_clara", list.id, "bok_3"), fails("tus listas"));
  assert.throws(() => repo.deleteReadingList("usr_clara", list.id), fails("tus listas"));
  assert.throws(() => repo.addToList("usr_ana", list.id, "bok_inexistente"), fails("no existe"));

  assert.deepEqual(repo.listIdsContainingBook("usr_ana", "bok_2"), [list.id]);

  repo.removeFromList("usr_ana", list.id, "bok_1");
  assert.equal(repo.getReadingList(list.id, "usr_ana")!.items, 1);

  assert.equal(repo.listReadingLists("usr_ana", "usr_ana")[0]!.items, 1);
  repo.deleteReadingList("usr_ana", list.id);
  assert.equal(repo.getReadingList(list.id, "usr_ana"), null);
});

test("los clubs nacen con su creador dentro y admiten altas y bajas", () => {
  const club = repo.createClub("usr_clara", {
    name: "Club de los martes",
    city: "Stuttgart",
    description: "Una lectura al mes, sin prisa.",
    bookId: "bok_1",
    meetsOn: "Último martes, 19:00",
  });
  assert.equal(club.members, 1);
  assert.equal(club.isMember, true);
  assert.equal(club.book?.id, "bok_1");

  const joined = repo.setClubMembership("usr_ana", club.id, true);
  assert.deepEqual(joined, { member: true, status: "member", members: 2, pending: 0 });

  const cities = repo.listClubs({ viewerId: "usr_ana", city: "Karlsruhe" });
  assert.equal(cities.clubs.length, 0);
  const stuttgart = repo.listClubs({ viewerId: "usr_ana", city: "Stuttgart" });
  const found = stuttgart.clubs.find((entry) => entry.id === club.id);
  assert.ok(found);
  assert.equal(found!.isMember, true);

  // Quien creó el club no puede salir.
  assert.throws(() => repo.setClubMembership("usr_clara", club.id, false), fails("no puede salir"));
  assert.deepEqual(repo.setClubMembership("usr_ana", club.id, false), {
    member: false,
    status: "none",
    members: 1,
    pending: 0,
  });

  assert.throws(
    () =>
      repo.createClub("usr_ana", {
        name: "Club fantasma",
        city: "Stuttgart",
        description: "",
        bookId: "bok_inexistente",
        meetsOn: "",
      }),
    fails("no existe"),
  );
});

test("un club de una cuenta suspendida deja de listarse", () => {
  const club = repo.createClub("usr_lucia", {
    name: "Lecturas del sur",
    city: "Karlsruhe",
    description: "",
    meetsOn: "",
  });
  assert.ok(repo.listClubs({ viewerId: null, city: "Karlsruhe" }).clubs.some((c) => c.id === club.id));

  repo.reportContent({
    reporterId: "usr_ana",
    targetType: "user",
    targetId: "usr_lucia",
    reason: "Comportamiento abusivo",
    details: "",
  });
  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_lucia",
  });
  assert.equal(repo.listClubs({ viewerId: null, city: "Karlsruhe" }).clubs.some((c) => c.id === club.id), false);
  assert.equal(repo.getClub(club.id, null), null);
  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: "usr_lucia",
  });
});
