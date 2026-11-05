import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type DbModule = typeof import("../src/lib/db/index.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let dbModule: DbModule;
let repo: RepoModule;
let anaKey = "";
let claraKey = "";

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  repo = await import("../src/lib/repo.ts");
  // Claves de juguete: el servidor solo guarda el JWK público y su huella, el
  // cifrado de verdad ocurre en el navegador.
  anaKey = repo.setPublicKey("usr_ana", {
    kty: "EC",
    crv: "P-256",
    x: "ana-publica-x",
    y: "ana-publica-y",
  }).keyId;
  claraKey = repo.setPublicKey("usr_clara", {
    kty: "EC",
    crv: "P-256",
    x: "clara-publica-x",
    y: "clara-publica-y",
  }).keyId;
});

/** Sobre cifrado de mentira: al servidor solo le importa que no sea texto plano. */
function sobre(keyId: string) {
  return {
    ciphertext: "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4",
    iv: "MTIzNDU2Nzg5MDEy",
    keyId,
  };
}

test("sin seguimiento mutuo no se abre ninguna conversación", () => {
  // La muestra deja a Ana siguiendo a Diego, pero Diego no la sigue.
  const vista = repo.directThread("usr_ana", "usr_diego");
  assert.equal(vista.canMessage, false);
  assert.equal(vista.reason, "mutual");
  assert.equal(vista.messages.length, 0);
  assert.throws(() => repo.sendDirectMessage("usr_ana", "usr_diego", sobre(anaKey)), {
    name: "ApiError",
  });
});

test("con seguimiento mutuo el mensaje se guarda cifrado y se lee en ambos lados", () => {
  const enviado = repo.sendDirectMessage("usr_ana", "usr_clara", sobre(anaKey));
  assert.equal(enviado.isMine, true);
  assert.equal(enviado.encrypted, true);
  assert.equal(enviado.ciphertext, sobre(anaKey).ciphertext);
  assert.equal(enviado.keyId, anaKey);

  const desdeClara = repo.directThread("usr_clara", "usr_ana");
  assert.equal(desdeClara.canMessage, true);
  assert.equal(desdeClara.reason, "ok");
  assert.equal(desdeClara.messages.length, 1);
  assert.equal(desdeClara.messages[0]!.isMine, false);
  assert.equal(desdeClara.messages[0]!.ciphertext, sobre(anaKey).ciphertext);
  assert.equal(desdeClara.peer.keyId, anaKey);
  assert.equal(desdeClara.me.keyId, claraKey);
  assert.equal(desdeClara.peer.keyJwk?.x, "ana-publica-x");

  // El hilo es el mismo para las dos partes.
  const desdeAna = repo.directThread("usr_ana", "usr_clara");
  assert.equal(desdeAna.id, desdeClara.id);
});

test("el contador de no leídos baja al marcar la conversación como leída", () => {
  assert.equal(repo.countUnreadDirectMessages("usr_clara"), 1);
  assert.equal(repo.countUnreadDirectMessages("usr_ana"), 0, "lo propio nace leído");

  repo.markDirectThreadRead("usr_clara", "usr_ana");
  assert.equal(repo.countUnreadDirectMessages("usr_clara"), 0);
});

test("el aviso de mensaje nuevo no se repite cada vez que se escribe", () => {
  repo.sendDirectMessage("usr_clara", "usr_ana", sobre(claraKey));
  repo.sendDirectMessage("usr_clara", "usr_ana", sobre(claraKey));

  const avisos = repo
    .listNotifications("usr_ana")
    .filter((notification) => notification.type === "direct");
  assert.equal(avisos.length, 1, "un solo aviso por conversación y media hora");
  assert.match(avisos[0]!.body, /Clara/);
  assert.equal(avisos[0]!.link, "/u/usr_clara?dm=1");
});

test("una huella que no es la tuya no se acepta", () => {
  assert.throws(() => repo.sendDirectMessage("usr_ana", "usr_clara", sobre(claraKey)), {
    name: "ApiError",
  });
});

test("quien no ha publicado clave no puede recibir mensajes", () => {
  // Clara y Diego se siguen, pero Diego no ha activado el cifrado.
  repo.setFollow("usr_clara", "usr_diego", true);
  repo.setFollow("usr_diego", "usr_clara", true);
  const vista = repo.directThread("usr_clara", "usr_diego");
  assert.equal(vista.peer.keyJwk, null);
  assert.equal(vista.canMessage, false);
  assert.equal(vista.reason, "no-key");
  assert.throws(() => repo.sendDirectMessage("usr_clara", "usr_diego", sobre(claraKey)), {
    name: "ApiError",
  });
});

test("un bloqueo cierra la conversación", () => {
  repo.blockUser("usr_clara", "usr_ana");
  assert.equal(repo.directThread("usr_clara", "usr_ana").reason, "blocked");
  assert.equal(repo.directThread("usr_ana", "usr_clara").canMessage, false);
  assert.throws(() => repo.sendDirectMessage("usr_ana", "usr_clara", sobre(anaKey)), {
    name: "ApiError",
  });
});

test("borrar la cuenta se lleva también las conversaciones directas", () => {
  const hilos = () =>
    (dbModule.getDb().prepare("SELECT COUNT(*) AS n FROM dm_threads").get() as { n: number }).n;
  assert.ok(hilos() > 0);

  repo.deleteAccount("usr_ana");
  assert.equal(hilos(), 0);
  assert.equal(repo.countUnreadDirectMessages("usr_clara"), 0);
});
