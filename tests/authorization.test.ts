/**
 * Matriz de permisos: quién puede tocar qué recurso.
 *
 * La auditoría del 9-nov dejó una pregunta abierta —«¿cada operación comprueba
 * que el recurso es de quien lo pide?»— que no se contesta leyendo una ruta
 * suelta: hay que recorrer las operaciones sensibles con la misma vara. Aquí se
 * fija la regla de cada recurso (solicitud, ejemplar, mensaje) con los cuatro
 * papeles en fila: dueño, otra parte, tercero y quien no ha hecho nada.
 *
 * El permiso vive en la consulta (el SQL filtra por participante o por
 * `owner_id`), no en un `if` del componente: por eso un id ajeno responde «no
 * existe» —404— en vez de «no puedes» —403—, que ya revelaría que existe.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

let contador = 0;

/** Ejemplar nuevo por prueba: ninguna depende del estado de la anterior. */
function ejemplar(ownerId: string) {
  contador += 1;
  return repo.createListing(ownerId, {
    title: `Matriz de permisos ${contador}`,
    author: "Autora de prueba",
    category: "Ficción",
    language: "Español",
    condition: "Buen estado",
    city: "Stuttgart",
    isbn: null,
    tags: [],
  });
}

const errorDe = (action: () => unknown): Error & { status?: number } => {
  try {
    action();
  } catch (error) {
    return error as Error & { status?: number };
  }
  assert.fail("se esperaba un error y no lo hubo");
};

/* --------------------------- solicitud de intercambio ---------------------- */

test("una solicitud solo la ven las dos personas del intercambio", () => {
  const listing = ejemplar("usr_clara");
  const solicitud = repo.createRequest("usr_ana", listing.id);

  assert.ok(repo.getRequest(solicitud.id, "usr_ana"), "quien la envía la ve");
  assert.ok(repo.getRequest(solicitud.id, "usr_clara"), "quien la recibe la ve");
  // Ni 403 ni error: se comporta como si no existiera.
  assert.equal(repo.getRequest(solicitud.id, "usr_diego"), null, "un tercero no la ve");
});

test("un tercero no puede cambiar el estado de una solicitud", () => {
  const listing = ejemplar("usr_clara");
  const solicitud = repo.createRequest("usr_ana", listing.id);

  const error = errorDe(() => repo.updateRequestStatus(solicitud.id, "usr_diego", "accepted"));
  assert.equal(error.status, 404, "no se confirma que la solicitud exista");
  assert.match(error.message, /no existe/i);
  // Y el estado no se ha movido.
  assert.equal(repo.getRequest(solicitud.id, "usr_clara")?.status, "pending");
});

test("quien pide no puede aceptar su propia solicitud", () => {
  const listing = ejemplar("usr_clara");
  const solicitud = repo.createRequest("usr_ana", listing.id);

  // `accepted` es del dueño: al solicitante se le rechaza por transición, no por
  // identidad, y el ejemplar sigue disponible.
  const error = errorDe(() => repo.updateRequestStatus(solicitud.id, "usr_ana", "accepted"));
  assert.equal(error.status, 409);
  assert.equal(repo.getListing(listing.id, "usr_clara")?.status, "available");
});

/* -------------------------------- ejemplares ------------------------------ */

test("solo el dueño cambia la disponibilidad de su ejemplar", () => {
  const listing = ejemplar("usr_clara");

  const error = errorDe(() => repo.setListingStatus("usr_diego", listing.id, "paused"));
  assert.equal(error.status, 403);
  assert.match(error.message, /tus publicaciones/);
  assert.equal(repo.getListing(listing.id, "usr_clara")?.status, "available", "nada cambió");

  repo.setListingStatus("usr_clara", listing.id, "paused");
  assert.equal(repo.getListing(listing.id, "usr_clara")?.status, "paused");
});

test("solo el dueño edita la ficha de su ejemplar", () => {
  const listing = ejemplar("usr_clara");

  const error = errorDe(() =>
    repo.editListing("usr_diego", listing.id, {
      condition: "Como nuevo",
      city: "Berlin",
      notes: "Cambiado por un tercero",
      tags: [],
    }),
  );
  assert.equal(error.status, 403);

  repo.editListing("usr_clara", listing.id, {
    condition: "Como nuevo",
    city: "Stuttgart",
    notes: "Editado por su dueña",
    tags: [],
  });
  assert.equal(repo.getListing(listing.id, "usr_clara")?.condition, "Como nuevo");
});

test("un ejemplar retirado o inexistente responde 404, no 403", () => {
  const error = errorDe(() => repo.setListingStatus("usr_clara", "lst_inexistente", "paused"));
  assert.equal(error.status, 404);
});

/* ------------------------------ mensajería -------------------------------- */

test("no se escribe a quien no te sigue de vuelta", () => {
  // Se parte de un estado conocido: sin seguimiento mutuo.
  repo.setFollow("usr_diego", "usr_marcos", false);
  repo.setFollow("usr_marcos", "usr_diego", false);
  assert.equal(repo.mutualFollow("usr_diego", "usr_marcos"), false);

  const error = errorDe(() =>
    repo.sendDirectMessage("usr_diego", "usr_marcos", {
      keyId: "huella-que-no-existe",
      ciphertext: "no-deberia-llegar",
      iv: "000000000000",
    }),
  );
  // 403 por la relación, antes de mirar claves ni sobres: el mensaje no se
  // guarda y la otra persona no ve nada.
  assert.equal(error.status, 403);
  assert.match(error.message, /también te sigue|intercambiado un libro/);
});

test("un seguimiento unilateral no abre la conversación", () => {
  repo.setFollow("usr_lucia", "usr_admin", true);
  repo.setFollow("usr_admin", "usr_lucia", false);
  assert.equal(repo.mutualFollow("usr_lucia", "usr_admin"), false);

  const error = errorDe(() =>
    repo.sendDirectMessage("usr_lucia", "usr_admin", {
      keyId: "huella-que-no-existe",
      ciphertext: "no-deberia-llegar",
      iv: "000000000000",
    }),
  );
  assert.equal(error.status, 403);
});
