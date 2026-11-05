import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type DbModule = typeof import("../src/lib/db/index.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let dbModule: DbModule;
let repo: RepoModule;

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  repo = await import("../src/lib/repo.ts");
});

const handoverCode = (requestId: string) =>
  (
    dbModule
      .getDb()
      .prepare("SELECT handover_code FROM requests WHERE id = ?")
      .get(requestId) as { handover_code: string }
  ).handover_code;

/** Cierra un intercambio con las dos confirmaciones. */
function completeExchange(requestId: string, ownerId: string, requesterId: string) {
  repo.updateRequestStatus(requestId, ownerId, "accepted");
  repo.updateRequestStatus(requestId, ownerId, "completed");
  return repo.updateRequestStatus(requestId, requesterId, "completed", {
    handoverCode: handoverCode(requestId),
  });
}

test("el muro público no muestra actividad de dueños suspendidos", () => {
  const beforeActivity = repo.listActivity(50);
  assert.ok(beforeActivity.some((item) => item.actor === "Clara Montes"));

  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_clara",
  });
  const afterActivity = repo.listActivity(50);
  assert.equal(afterActivity.some((item) => item.actor === "Clara Montes"), false);

  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: "usr_clara",
  });
});

test("las cifras de la portada ignoran cuentas suspendidas", () => {
  // La demostración trae un club propio: la prueba mide el efecto de crear y
  // suspender, así que parte de una tabla sin clubes.
  dbModule.getDb().prepare("DELETE FROM clubs").run();
  const before = repo.getStats();
  repo.createClub("usr_clara", {
    name: "Club de cifras",
    city: "Stuttgart",
    description: "",
    meetsOn: "",
    joinPolicy: "open",
  });
  const withClub = repo.getStats();
  assert.equal(withClub.clubs, before.clubs + 1);

  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_clara",
  });
  const suspended = repo.getStats();
  // Ni el club ni los ejemplares de una cuenta suspendida cuentan.
  assert.equal(suspended.clubs, before.clubs);
  assert.ok(suspended.available < withClub.available);

  repo.moderateTarget("usr_admin", {
    action: "unsuspend_user",
    targetType: "user",
    targetId: "usr_clara",
  });
  assert.equal(repo.getStats().clubs, withClub.clubs);
});

test("un bloqueo oculta las reseñas que esa persona te dejó", () => {
  const request = repo.createRequest("usr_ana", "lst_4", "");
  const completed = completeExchange(request.id, "usr_marcos", "usr_ana");
  assert.equal(completed.status, "completed");

  repo.addReview(request.id, "usr_marcos", 5, "Todo perfecto.");
  const visible = repo.listReviews("usr_ana", 50, "usr_ana");
  assert.ok(visible.some((review) => review.comment === "Todo perfecto."));
  assert.equal(repo.getPublicProfile("usr_ana", "usr_ana")?.ratingCount, 1);

  repo.blockUser("usr_ana", "usr_marcos");
  const blocked = repo.listReviews("usr_ana", 50, "usr_ana");
  assert.equal(blocked.some((review) => review.comment === "Todo perfecto."), false);
  // La media del perfil aplica el mismo filtro que la lista.
  assert.equal(repo.getPublicProfile("usr_ana", "usr_ana")?.ratingCount, 0);
});

test("el contador de comentarios coincide con el hilo y respeta bloqueos", () => {
  const bookId = "bok_2";
  const thread = repo.listBookComments(bookId, { id: "usr_ana", isAdmin: false });
  assert.equal(repo.countBookComments(bookId, "usr_ana"), thread.total);

  // Clara respondió en el hilo: al bloquearla, ese mensaje deja de contar.
  repo.blockUser("usr_ana", "usr_clara");
  const blocked = repo.listBookComments(bookId, { id: "usr_ana", isAdmin: false });
  assert.equal(repo.countBookComments(bookId, "usr_ana"), blocked.total);
  assert.ok(blocked.total < thread.total);
});

test("los ejemplares de una obra se filtran en SQL y el contador es exacto", () => {
  const copies = repo.listingsForBook("bok_1", null);
  assert.equal(copies.length, 1);
  assert.equal(repo.countListingsForBook("bok_1", null), 1);

  assert.equal(repo.listingsForBook("bok_1", null, { city: "Mannheim" }).length, 0);
  assert.equal(repo.listingsForBook("bok_1", null, { city: "Stuttgart" }).length, 1);
});

test("un intercambio cerrado deja de contar si una parte se da de baja", () => {
  const before = repo.getStats().completed;
  const request = repo.createRequest("usr_ana", "lst_2", "");
  const completed = completeExchange(request.id, "usr_diego", "usr_ana");
  assert.equal(completed.status, "completed");
  assert.equal(repo.getStats().completed, before + 1);

  // Diego solo participa en este intercambio, así que al borrar la cuenta la
  // cifra vuelve exactamente al punto de partida.
  repo.deleteAccount("usr_diego");
  assert.equal(repo.getStats().completed, before);
});
