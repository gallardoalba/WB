import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.BOOK2PEER_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

test("un club puede prestar y recuperar un ejemplar", () => {
  const club = repo.createClub("usr_clara", {
    name: "Club de préstamo",
    city: "Stuttgart",
    description: "Rotación de ejemplares",
    bookId: "bok_1",
    meetsOn: "Último martes, 19:00",
    joinPolicy: "open",
  });
  repo.setClubMembership("usr_diego", club.id, true);

  const loan = repo.createClubLoan({
    clubId: club.id,
    listingId: "lst_1",
    lenderId: "usr_clara",
    borrowerId: "usr_diego",
    dueAt: "2030-01-31",
  });
  assert.equal(loan.title, "La biblioteca de la medianoche");
  assert.equal(repo.getListing("lst_1", "usr_clara")?.status, "reserved");
  assert.equal(repo.listClubLoans(club.id, "usr_clara").filter((item) => !item.returnedAt).length, 1);
  assert.throws(
    () =>
      repo.createClubLoan({
        clubId: club.id,
        listingId: "lst_1",
        lenderId: "usr_clara",
        borrowerId: "usr_diego",
      }),
    (error: unknown) => error instanceof Error,
  );

  const returned = repo.returnClubLoan(loan.id, "usr_diego");
  assert.ok(returned.returnedAt);
  assert.equal(repo.getListing("lst_1", "usr_clara")?.status, "available");
});
