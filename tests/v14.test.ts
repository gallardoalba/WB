import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.BOOK2PEER_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type ApiModule = typeof import("../src/lib/api.ts");
type TokensModule = typeof import("../src/lib/account-tokens.ts");

let repo: RepoModule;
let apiModule: ApiModule;
let tokens: TokensModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  apiModule = await import("../src/lib/api.ts");
  tokens = await import("../src/lib/account-tokens.ts");
});

test("las dos partes de un intercambio pueden valorarse", () => {
  // En el sembrado Ana ya valoró a Lucía; ahora Lucía puede valorar a Ana.
  repo.addReview("req_seed_1", "usr_lucia", 4, "Devolvió el libro puntual.");
  const reviews = repo.listReviews("usr_ana");
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]!.rating, 4);
  assert.equal(repo.getPublicProfile("usr_ana", null)?.ratingCount, 1);

  assert.throws(
    () => repo.addReview("req_seed_1", "usr_lucia", 5, "Otra vez"),
    (error: unknown) => error instanceof Error && error.message.includes("Ya has valorado"),
  );
});

test("el muro no revela el texto de un comentario con spoiler", () => {
  const spoiler = repo.createBookComment({
    bookId: "bok_2",
    authorId: "usr_clara",
    body: "El asesino es el mayordomo: spoiler que no debe salir del hilo.",
    spoiler: true,
  });
  const conversations = repo.listRecentComments(20);
  const entry = conversations.find((item) => item.id === spoiler.id);
  assert.ok(entry);
  assert.equal(entry!.excerpt.includes("mayordomo"), false);
  assert.match(entry!.excerpt, /spoiler/i);
});

test("el total del hilo coincide con el contador de la ficha aunque haya ocultos", () => {
  const comment = repo.createBookComment({
    bookId: "bok_5",
    authorId: "usr_ana",
    body: "Comentario que se ocultará y no debe descuadrar el total.",
    spoiler: false,
  });
  repo.moderateTarget("usr_admin", {
    action: "hide_comment",
    targetType: "comment",
    targetId: comment.id,
  });

  const forAuthor = repo.listBookComments("bok_5", { id: "usr_ana", isAdmin: false });
  assert.equal(forAuthor.total, repo.countBookComments("bok_5"));
});

test("bloquear corta los seguimientos y oculta los ejemplares", () => {
  repo.setFollow("usr_ana", "usr_diego", true);
  assert.equal(repo.getFollowState("usr_diego", "usr_ana").isFollowing, true);
  assert.ok(repo.getListing("lst_2", "usr_ana"));

  repo.blockUser("usr_ana", "usr_diego");
  assert.equal(repo.getFollowState("usr_diego", "usr_ana").isFollowing, false);
  assert.equal(repo.getListing("lst_2", "usr_ana"), null);
  assert.equal(repo.getPublicProfile("usr_diego", "usr_ana")!.listingsTotal, 0);
});

test("restablecer un ejemplar devuelve el estado que tenía antes", () => {
  const listing = repo.createListing("usr_clara", {
    title: "Libro pausado y moderado",
    author: "Prueba",
    category: "Humanidades",
    condition: "Buen estado",
    isbn: null,
    city: "Stuttgart",
    tags: [],
  });
  repo.setListingStatus("usr_clara", listing.id, "paused");

  repo.moderateTarget("usr_admin", {
    action: "hide_listing",
    targetType: "listing",
    targetId: listing.id,
  });
  assert.equal(repo.getListing(listing.id, "usr_clara"), null);

  repo.moderateTarget("usr_admin", {
    action: "restore_listing",
    targetType: "listing",
    targetId: listing.id,
  });
  assert.equal(repo.getListing(listing.id, "usr_clara")?.status, "paused");
});

test("la moderación cancela el intercambio aceptado y no se puede completar", () => {
  const listing = repo.createListing("usr_clara", {
    title: "Libro con intercambio y denuncia",
    author: "Prueba",
    category: "Humanidades",
    condition: "Buen estado",
    isbn: null,
    city: "Stuttgart",
    tags: [],
  });
  const request = repo.createRequest("usr_diego", listing.id, "Me interesa");
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");

  repo.moderateTarget("usr_admin", {
    action: "hide_listing",
    targetType: "listing",
    targetId: listing.id,
  });

  assert.throws(
    () => repo.updateRequestStatus(request.id, "usr_clara", "completed"),
    (error: unknown) => error instanceof Error,
  );
  assert.ok(
    repo
      .listNotifications("usr_diego")
      .some((notification) => notification.type === "moderation"),
  );
});

test("borrar la cuenta elimina clubs, avisos y bloqueos", () => {
  const user = repo.createUser({
    name: "Lectora Temporal",
    email: "temporal@book2peer.test",
    passwordHash: "x",
    city: "Ulm",
  });
  const club = repo.createClub(user.id, {
    name: "Club temporal",
    city: "Ulm",
    description: "",
    meetsOn: "",
  });
  repo.notify({ userId: user.id, type: "message", title: "Aviso temporal" });
  repo.blockUser(user.id, "usr_ana");

  repo.deleteAccount(user.id);

  assert.equal(repo.getClub(club.id, "usr_ana"), null);
  assert.equal(repo.getUserById(user.id)?.isSuspended, true);
});

test("los nombres del equipo están reservados", () => {
  assert.throws(
    () => repo.updateProfile("usr_ana", { name: "Book2Peer Soporte", bio: "", city: "Stuttgart" }),
    (error: unknown) => error instanceof Error && error.message.includes("reservado"),
  );
  assert.throws(
    () =>
      repo.createUser({
        name: "Moderación",
        email: "falsa@book2peer.test",
        passwordHash: "x",
        city: "Stuttgart",
      }),
    (error: unknown) => error instanceof Error && error.message.includes("reservado"),
  );
});

test("readJson corta los cuerpos demasiado grandes", async () => {
  const big = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pad: "x".repeat(80 * 1024) }),
  });
  await assert.rejects(
    () => apiModule.readJson(big),
    (error: unknown) =>
      error instanceof Error && "status" in error && (error as { status: number }).status === 413,
  );

  const ok = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true }),
  });
  assert.deepEqual(await apiModule.readJson(ok), { ok: true });
});

test("un token de cuenta solo se puede consumir una vez", () => {
  const raw = tokens.issueAccountToken("usr_clara", "reset_password");
  assert.equal(tokens.consumeAccountToken(raw, "reset_password"), "usr_clara");
  assert.equal(tokens.consumeAccountToken(raw, "reset_password"), null);
});
