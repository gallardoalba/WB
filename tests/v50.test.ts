import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

/**
 * La conversación de un intercambio no existe hasta que se acepta: mientras la
 * solicitud está pendiente no hay entrega que coordinar, y cuando termina
 * rechazada o cancelada ya no hay nada que decir. El hilo se conserva para
 * poder releerlo.
 */
test("una solicitud pendiente no abre la conversación", () => {
  const request = repo.createRequest("usr_ana", "lst_3", "");
  assert.equal(request.status, "pending");
  assert.throws(
    () => repo.addMessage(request.id, "usr_lucia", "Hola"),
    /todavía no podéis escribir/i,
  );
  assert.throws(
    () => repo.addMessage(request.id, "usr_ana", "Hola"),
    /todavía no podéis escribir/i,
  );
  // Tampoco desde el cliente cifrado: la comprobación va antes que las claves.
  assert.throws(
    () =>
      repo.addEncryptedMessage(request.id, "usr_ana", {
        keyId: "clave-inventada",
        envelopes: [],
      }),
    /todavía no podéis escribir/i,
  );
});

test("la conversación se abre al aceptar y se cierra al cancelarla", () => {
  const request = repo.createRequest("usr_ana", "lst_4", "");
  repo.updateRequestStatus(request.id, "usr_marcos", "accepted");

  const first = repo.addMessage(request.id, "usr_marcos", "¿Te viene bien el martes?");
  assert.equal(first.body, "¿Te viene bien el martes?");

  // Cancelar un intercambio aceptado sigue siendo posible, por cualquiera de
  // las dos partes.
  const cancelled = repo.updateRequestStatus(request.id, "usr_ana", "cancelled");
  assert.equal(cancelled.status, "cancelled");

  assert.throws(
    () => repo.addMessage(request.id, "usr_ana", "Sigo interesada"),
    /cerrado/i,
  );
  assert.throws(
    () => repo.addMessage(request.id, "usr_marcos", "Vale"),
    /cerrado/i,
  );
  // Lo ya escrito se puede seguir leyendo.
  assert.equal(repo.listMessages(request.id, "usr_ana").messages.length, 1);
});

test("quien publica también puede cancelar el intercambio aceptado", () => {
  const request = repo.createRequest("usr_ana", "lst_5", "");
  repo.updateRequestStatus(request.id, "usr_clara", "accepted");
  const cancelled = repo.updateRequestStatus(request.id, "usr_clara", "cancelled");
  assert.equal(cancelled.status, "cancelled");
});
