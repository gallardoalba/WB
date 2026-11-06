import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type ValidationModule = typeof import("../src/lib/validation.ts");

let repo: RepoModule;
let validation: ValidationModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  validation = await import("../src/lib/validation.ts");
});

test("el perfil se puede editar (nombre, ciudad y biografía)", () => {
  const updated = repo.updateProfile("usr_ana", {
    name: "Ana M.",
    bio: "Leo sobre todo ensayo.",
    city: "Mannheim",
  });
  assert.equal(updated.name, "Ana M.");
  assert.equal(updated.bio, "Leo sobre todo ensayo.");
  assert.equal(repo.getPublicProfile("usr_ana", null)?.user.bio, "Leo sobre todo ensayo.");
});

test("una categoría desconocida se ignora en vez de vaciar el catálogo", () => {
  const parsed = validation.catalogParamsSchema.parse({ category: "Narrativ" });
  assert.equal(parsed.category, "Todos");
  const valid = validation.catalogParamsSchema.parse({ category: "Humanidades" });
  assert.equal(valid.category, "Humanidades");
});

test("los mensajes se paginan y respetan el cursor", () => {
  const request = repo.createRequest("usr_ana", "lst_3", "Hola");
  repo.updateRequestStatus(request.id, "usr_lucia", "accepted");
  for (let index = 0; index < 12; index += 1) {
    repo.addMessage(request.id, "usr_lucia", `Mensaje ${index}`);
  }

  const latest = repo.listMessages(request.id, "usr_ana", { limit: 5 });
  assert.equal(latest.messages.length, 5);
  assert.equal(latest.hasMore, true);
  assert.equal(latest.messages.at(-1)?.body, "Mensaje 11");

  const older = repo.listMessages(request.id, "usr_ana", {
    limit: 5,
    beforeId: latest.messages[0]!.id,
  });
  assert.equal(older.messages.length, 5);
  assert.equal(older.messages.at(-1)?.body, "Mensaje 6");
});

test("la exportación incluye reseñas, favoritos, avisos y bloqueos", () => {
  // La valoración de Ana a Lucía viene en el sembrado.
  repo.setFavorite("usr_ana", "lst_2", true);
  repo.notify({ userId: "usr_ana", type: "message", title: "Hola" });
  repo.blockUser("usr_ana", "usr_diego");

  const data = repo.exportAccountData("usr_ana");
  for (const key of [
    "listings",
    "requests",
    "messages",
    "favorites",
    "reviewsGiven",
    "reviewsReceived",
    "notifications",
    "blocks",
    "reportsFiled",
  ]) {
    assert.ok(Array.isArray((data as Record<string, unknown>)[key]), `falta ${key}`);
  }
  assert.ok(data.reviewsGiven.length >= 1);
  assert.ok(data.favorites.length >= 1);
  assert.ok(data.blocks.length >= 1);
  assert.equal("passwordHash" in data.user, false);
});

test("una reseña ajena se puede denunciar y la propia no", () => {
  const [review] = repo.listReviews("usr_lucia");
  assert.ok(review);

  assert.throws(
    () =>
      repo.reportContent({
        reporterId: "usr_ana",
        targetType: "review",
        targetId: review.id,
        reason: "Contenido inapropiado",
        details: "",
      }),
    (error: unknown) => error instanceof Error && error.message.includes("no existe"),
  );

  repo.reportContent({
    reporterId: "usr_clara",
    targetType: "review",
    targetId: review.id,
    reason: "Contenido inapropiado",
    details: "Insultos",
  });
  assert.ok(repo.listReports().some((item) => item.targetType === "review"));
});

test("los avisos se pueden leer y borrar de uno en uno", () => {
  const notifications = repo.listNotifications("usr_ana", { limit: 1 });
  const target = notifications[0];
  assert.ok(target);

  assert.equal(repo.markNotificationRead("usr_diego", target.id), false);
  assert.equal(repo.markNotificationRead("usr_ana", target.id), true);
  assert.equal(repo.markNotificationRead("usr_ana", target.id), false);

  repo.deleteNotification("usr_ana", target.id);
  assert.equal(
    repo.listNotifications("usr_ana", { limit: 50 }).some((item) => item.id === target.id),
    false,
  );
  assert.throws(
    () => repo.deleteNotification("usr_clara", target.id),
    (error: unknown) => error instanceof Error && error.message.includes("no existe"),
  );
});

test("el panel de denuncias se pagina y cuenta", () => {
  for (let index = 0; index < 30; index += 1) {
    repo.notify({ userId: "usr_clara", type: "message", title: `Relleno ${index}` });
  }
  const total = repo.countOpenReports();
  assert.ok(total >= 1);

  const first = repo.listReports({ limit: 5, offset: 0 });
  assert.ok(first.length <= 5);
  assert.ok(first.every((item) => item.targetLabel.length > 0));
});

test("editar y retirar un ejemplar respeta el estado sin carreras", () => {
  repo.setListingStatus("usr_clara", "lst_5", "paused");
  assert.throws(
    () => repo.setListingStatus("usr_ana", "lst_5", "available"),
    (error: unknown) => error instanceof Error && error.message.includes("Solo puedes gestionar"),
  );
  repo.removeListing("usr_clara", "lst_5");
  assert.equal(repo.getListing("lst_5", null), null);
  // Retirar dos veces no rompe: la segunda ya no encuentra el ejemplar.
  assert.throws(() => repo.removeListing("usr_clara", "lst_5"), (error: unknown) => error instanceof Error);
});
