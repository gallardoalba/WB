import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.BOOK2PEER_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

test("el recorrido cuenta intercambios, kilómetros y ciudades", () => {
  const ana = repo.getReaderJourney("usr_ana");
  // Ana recibió un libro de Lucía (Karlsruhe → Stuttgart).
  assert.equal(ana.received, 1);
  assert.equal(ana.given, 0);
  assert.ok(ana.km > 0, "los kilómetros salen de la matriz de ciudades");
  assert.equal(ana.cities, 2);
  assert.equal(ana.comments, 1);

  const firstSwap = ana.badges.find((badge) => badge.id === "first-swap");
  assert.equal(firstSwap?.earned, true);
  assert.equal(ana.badges.find((badge) => badge.id === "ten-shared")?.earned, false);

  const lucia = repo.getReaderJourney("usr_lucia");
  assert.equal(lucia.given, 1);
  assert.ok(lucia.shared >= 1);
});

test("las insignias se ganan con el uso real", () => {
  const list = repo.createReadingList("usr_clara", { title: "Clásicos del sur", description: "" });
  repo.addToList("usr_clara", list.id, "bok_1");
  repo.addToList("usr_clara", list.id, "bok_2");
  repo.addToList("usr_clara", list.id, "bok_3");
  const journey = repo.getReaderJourney("usr_clara");
  assert.equal(journey.lists, 1);
  assert.equal(journey.badges.find((badge) => badge.id === "curator")?.earned, true);
});
