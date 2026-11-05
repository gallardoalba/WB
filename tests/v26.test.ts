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

test("el catálogo filtra por idioma del libro", () => {
  // La muestra de partida es alemana; se añaden ejemplares en otros idiomas para
  // comprobar que el filtro no se queda con la muestra entera.
  repo.createListing("usr_ana", {
    title: "El infinito en un junco",
    author: "Irene Vallejo",
    category: "Humanidades",
    condition: "Buen estado",
    isbn: "9788417860790",
    city: "Stuttgart",
    language: "Español",
    tags: [],
  });
  repo.createListing("usr_ana", {
    title: "The Midnight Library",
    author: "Matt Haig",
    category: "Ficción",
    condition: "Buen estado",
    isbn: "9781786892737",
    city: "Stuttgart",
    language: "Inglés",
    tags: [],
  });

  const spanish = repo.catalogPage("usr_ana", params({ language: "Español" }));
  assert.ok(spanish.total > 0);
  for (const listing of spanish.items) assert.equal(listing.language, "Español");

  const english = repo.catalogPage("usr_ana", params({ language: "Inglés" }));
  assert.ok(english.total > 0);
  for (const listing of english.items) assert.equal(listing.language, "Inglés");

  const german = repo.catalogPage("usr_ana", params({ language: "Alemán" }));
  assert.ok(german.total > 0);
  for (const listing of german.items) assert.equal(listing.language, "Alemán");
});

test("los estados de lectura se guardan, cambian y se borran", () => {
  const reading = repo.setReadingState("usr_ana", "bok_1", "reading");
  assert.equal(reading.status, "reading");
  assert.equal(reading.reading, 1);
  assert.equal(repo.getReadingState("usr_ana", "bok_1"), "reading");

  const read = repo.setReadingState("usr_ana", "bok_1", "read");
  assert.equal(read.status, "read");
  assert.equal(read.reading, 0);
  assert.equal(read.read, 1);

  const cleared = repo.setReadingState("usr_ana", "bok_1", null);
  assert.equal(cleared.status, null);
  assert.equal(cleared.read, 0);
});

test("el código de entrega lo ve quien entrega y lo exige quien recibe", () => {
  const accepted = repo.updateRequestStatus("req_seed_2", "usr_clara", "accepted");
  assert.equal(accepted.status, "accepted");

  const ownerView = repo.listRequests("usr_clara").find((request) => request.id === "req_seed_2");
  assert.match(ownerView?.handoverCode ?? "", /^\d{6}$/);

  const requesterView = repo
    .listRequests("usr_diego")
    .find((request) => request.id === "req_seed_2");
  assert.equal(requesterView?.handoverCode, null);
  assert.equal(requesterView?.handoverCodeRequired, true);

  assert.throws(
    () => repo.updateRequestStatus("req_seed_2", "usr_diego", "completed"),
    (error: unknown) => error instanceof Error && error.message.includes("código"),
  );
  assert.throws(
    () =>
      repo.updateRequestStatus("req_seed_2", "usr_diego", "completed", {
        handoverCode: "000000",
      }),
    (error: unknown) => error instanceof Error && error.message.includes("código"),
  );

  const confirmed = repo.updateRequestStatus("req_seed_2", "usr_diego", "completed", {
    handoverCode: ownerView!.handoverCode!,
  });
  assert.equal(confirmed.status, "accepted");
  assert.equal(confirmed.confirmedByMe, true);

  const completed = repo.updateRequestStatus("req_seed_2", "usr_clara", "completed");
  assert.equal(completed.status, "completed");
});
