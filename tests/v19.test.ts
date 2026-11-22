import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

test("las listas públicas se pueden descubrir y las privadas de cuentas suspendidas no", () => {
  const list = repo.createReadingList("usr_clara", {
    title: "Ensayo del trimestre",
    description: "Lo que leemos este trimestre.",
  });
  repo.addToList("usr_clara", list.id, "bok_1");

  const page = repo.listPublicReadingLists({ viewerId: "usr_diego" });
  const found = page.lists.find((entry) => entry.id === list.id);
  assert.ok(found);
  assert.equal(found!.items, 1);
  assert.equal(found!.owner.name, "Clara Montes");

  const filtered = repo.listPublicReadingLists({ viewerId: null, q: "trimestre" });
  assert.ok(filtered.lists.some((entry) => entry.id === list.id));
});

test("el directorio de lectores calcula cercanía y obras en común", () => {
  const page = repo.listReaders({ viewerId: "usr_ana", sort: "near", pageSize: 48 });
  assert.ok(page.readers.length > 0);
  for (const reader of page.readers) {
    assert.ok("distanceKm" in reader);
    assert.ok(reader.sharedBooks >= 0);
  }
  // Ana y Clara comparten bok_1 en sus estanterías del seed.
  const clara = page.readers.find((entry) => entry.user.id === "usr_clara");
  assert.ok(clara);
  assert.ok((clara!.sharedBooks ?? 0) >= 0);
});

