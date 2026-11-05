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

test("el radio limita el catálogo a la distancia real", () => {
  const near = repo.catalogPage("usr_ana", params({ radius: 10 }));
  assert.ok(near.total > 0);
  for (const listing of near.items) {
    assert.notEqual(listing.distanceKm, null);
    assert.ok((listing.distanceKm ?? Infinity) <= 10);
  }

  const all = repo.catalogPage("usr_ana", params({ radius: 0 }));
  assert.ok(all.total > near.total);
});

test("una lista de deseos avisa cuando el libro aparece en tu ciudad", () => {
  const result = repo.setBookWant("usr_ana", "bok_2", true);
  assert.equal(result.wanted, true);
  assert.equal(result.count, 0);
  assert.equal(repo.countBookWants("bok_2", "Stuttgart"), 1);
  assert.equal(repo.isBookWanted("usr_ana", "bok_2"), true);

  const listing = repo.createListing("usr_clara", {
    title: "Triebstruktur und Gesellschaft",
    author: "Herbert Marcuse",
    category: "Sociedad y política",
    condition: "Buen estado",
    isbn: "9783518244043",
    city: "Stuttgart",
    language: "Alemán",
    tags: [],
  });

  const notice = repo
    .listNotifications("usr_ana")
    .find((notification) => notification.type === "want");
  assert.ok(notice);
  assert.equal(notice!.listingId, listing.id);
  assert.match(notice!.body, /Triebstruktur und Gesellschaft/);

  repo.setBookWant("usr_ana", "bok_2", false);
  assert.equal(repo.isBookWanted("usr_ana", "bok_2"), false);
});
