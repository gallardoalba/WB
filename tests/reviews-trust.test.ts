/**
 * Valoraciones de un intercambio: quién puede opinar y qué se ve.
 *
 * Una valoración es reputación pública, así que las reglas son estrictas: solo
 * opina quien participó, solo cuando el intercambio está **completado** y solo
 * una vez. Y lo que se lee también importa: quien ha bloqueado a alguien no
 * debe seguir viendo sus valoraciones en el perfil.
 */
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

/** Publica un ejemplar, lo solicita otra cuenta y cierra el intercambio. */
function intercambioCompletado(titulo: string, solicitante = "usr_ana") {
  const ejemplar = repo.createListing("usr_marcos", {
    title: titulo,
    author: "Autora",
    category: "Ficción",
    condition: "Buen estado",
    isbn: null,
    city: "Leipzig",
    tags: [],
  });
  const solicitud = repo.createRequest(solicitante, ejemplar.id);
  repo.updateRequestStatus(solicitud.id, "usr_marcos", "accepted");
  // El cierre es bilateral: cada parte confirma la entrega por su lado.
  repo.updateRequestStatus(solicitud.id, "usr_marcos", "completed");
  const cerrada = repo.updateRequestStatus(solicitud.id, solicitante, "completed");
  assert.equal(cerrada.status, "completed");
  return { ejemplar, solicitud };
}

test("solo se valora un intercambio completado y solo una vez por persona", () => {
  const { solicitud } = intercambioCompletado("Valoración pendiente");

  // Una solicitud recién creada no se puede valorar.
  const abierta = repo.createListing("usr_marcos", {
    title: "Todavía sin aceptar",
    author: "Autora",
    category: "Ficción",
    condition: "Buen estado",
    isbn: null,
    city: "Leipzig",
    tags: [],
  });
  const pendiente = repo.createRequest("usr_ana", abierta.id);
  assert.throws(() => repo.addReview(pendiente.id, "usr_ana", 5, "Genial"), {
    name: "ApiError",
    message: /Solo puedes valorar un intercambio completado/,
  });

  // Quien no participó no ve ni toca la solicitud.
  assert.throws(() => repo.addReview(solicitud.id, "usr_clara", 5, "Intrusa"), {
    name: "ApiError",
    message: /La solicitud no existe/,
  });

  repo.addReview(solicitud.id, "usr_ana", 5, "Todo perfecto");
  assert.equal(repo.hasReviewed(solicitud.id, "usr_ana"), true);
  assert.equal(repo.hasReviewed(solicitud.id, "usr_marcos"), false);

  // Repetir no duplica la valoración.
  assert.throws(() => repo.addReview(solicitud.id, "usr_ana", 1, "Otra vez"), {
    name: "ApiError",
    message: /Ya has valorado este intercambio/,
  });

  // La otra parte también puede opinar, y consta como autora distinta.
  repo.addReview(solicitud.id, "usr_marcos", 4, "Rápida y cuidadosa");
  const recibidas = repo.listReviews("usr_marcos");
  assert.equal(recibidas.some((review) => review.comment === "Todo perfecto"), true);
  assert.equal(recibidas.find((review) => review.comment === "Todo perfecto")?.rating, 5);
});

test("las valoraciones de quien has bloqueado no se muestran", () => {
  const { solicitud } = intercambioCompletado("Valoración a medias");
  repo.addReview(solicitud.id, "usr_ana", 5, "Muy bien");

  // Clara mira el perfil de Marcos antes del bloqueo y ve la valoración de Ana.
  const antes = repo.listReviews("usr_marcos", 10, "usr_clara");
  assert.equal(antes.some((review) => review.authorId === "usr_ana"), true);

  // Clara bloquea a Ana: su opinión desaparece para ella.
  dbModule
    .getDb()
    .prepare(
      `INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at)
       VALUES ('usr_clara', 'usr_ana', '2026-01-01T00:00:00.000Z')`,
    )
    .run();
  const despues = repo.listReviews("usr_marcos", 10, "usr_clara");
  assert.equal(
    despues.some((review) => review.authorId === "usr_ana"),
    false,
    "una valoración de quien has bloqueado no se lee",
  );

  // Sin sesión (o sin bloqueo) la valoración sigue siendo pública.
  assert.equal(
    repo.listReviews("usr_marcos").some((review) => review.authorId === "usr_ana"),
    true,
  );
});

test("una cuenta suspendida no deja valoraciones visibles", () => {
  const { solicitud } = intercambioCompletado("Valoración de suspendida", "usr_diego");
  repo.addReview(solicitud.id, "usr_diego", 3, "Regular");

  assert.equal(
    repo.listReviews("usr_marcos").some((review) => review.authorId === "usr_diego"),
    true,
  );

  repo.moderateTarget("usr_admin", {
    action: "suspend_user",
    targetType: "user",
    targetId: "usr_diego",
  });
  assert.equal(
    repo.listReviews("usr_marcos").some((review) => review.authorId === "usr_diego"),
    false,
    "suspender a alguien retira sus valoraciones de las fichas ajenas",
  );
});
