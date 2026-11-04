import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.BOOK2PEER_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

test("las recomendaciones comparten categoría y excluyen el libro actual", () => {
  const similar = repo.similarListings("bok_1", null, 3);
  assert.ok(similar.length > 0);
  assert.ok(similar.length <= 3);
  assert.equal(new Set(similar.map((listing) => listing.id)).size, similar.length);
  for (const listing of similar) {
    assert.notEqual(listing.bookId, "bok_1");
    assert.equal(listing.status, "available");
    assert.equal(listing.category, "Ficción");
  }
});

test("las recomendaciones respetan el límite solicitado", () => {
  const all = repo.similarListings("bok_1", "usr_ana", 8);
  assert.ok(all.length <= 8);
  for (const listing of all) {
    assert.equal(listing.status, "available");
    assert.notEqual(listing.bookId, "bok_1");
  }
});
