/**
 * Lecturas nuevas para el cliente Android.
 *
 * La web pinta clubes, listas y solicitudes en el servidor; la app nativa no
 * puede leer HTML, así que esas colecciones se exponen en JSON. Estas pruebas
 * fijan lo importante: una solicitud solo la ven sus dos partes y las listas
 * devuelven sus obras en el orden en que se añadieron.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

test("una solicitud solo la ven quien pide y quien ofrece", () => {
  const request = repo
    .listRequests("usr_diego")
    .find((entry) => entry.requester.id === "usr_diego");
  assert.ok(request, "la muestra no tiene una solicitud de usr_diego");

  assert.equal(repo.getRequest(request.id, "usr_diego")?.id, request.id);
  assert.equal(repo.getRequest(request.id, "usr_clara")?.id, request.id);
  // Conocer el identificador no basta: un tercero recibe «no existe».
  assert.equal(repo.getRequest(request.id, "usr_marcos"), null);
  assert.equal(repo.getRequest("req_que_no_existe", "usr_diego"), null);
});

test("una lista guarda sus obras y las devuelve en orden", () => {
  const works = repo.listPublicWorks();
  assert.ok(works.length >= 2, "el catálogo público necesita dos obras");
  const list = repo.createReadingList("usr_marcos", {
    title: "Lista de prueba",
    description: "",
    showOwner: false,
  });
  repo.addToList("usr_marcos", list.id, works[0]!.id);
  repo.addToList("usr_marcos", list.id, works[1]!.id);

  const detail = repo.getReadingList(list.id, "usr_marcos");
  assert.ok(detail, "la lista recién creada no se puede leer");
  assert.equal(detail.books.length, 2);
  assert.deepEqual(
    detail.books.map((book) => book.bookId),
    [works[0]!.id, works[1]!.id],
  );
  assert.equal(detail.isMine, true);
});

test("los clubes se pueden leer por id y aparecen en el listado", () => {
  const page = repo.listClubs({ viewerId: "usr_marcos" });
  assert.ok(page.total > 0, "la muestra no tiene clubes");
  const id = page.clubs[0]!.id;
  const club = repo.getClub(id, "usr_marcos");
  assert.ok(club, "el club del listado no se puede abrir por id");
  assert.equal(club.id, id);
  assert.equal(repo.getClub("clb_que_no_existe", "usr_marcos"), null);
});

test("la estantería separa lo propio de lo guardado", () => {
  const mine = repo.shelfListings("usr_marcos", "mine", 1);
  for (const listing of mine.items) {
    assert.equal(listing.isMine, true);
  }
  const saved = repo.shelfListings("usr_marcos", "saved", 1);
  for (const listing of saved.items) {
    assert.equal(listing.isFavorite, true);
  }
});
