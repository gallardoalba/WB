/**
 * v40: mensajería cifrada en el navegador y en la app a la vez.
 *
 * Cada dispositivo publica su clave en una ranura (`web`, `android`) y los
 * mensajes llevan un sobre por cada clave del destinatario. Estas pruebas fijan
 * lo que no puede romperse: publicar en el móvil no pisa la clave del navegador,
 * rotar una ranura exige contraseña y el servidor solo acepta sobres dirigidos
 * a claves de la otra persona.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

/** JWK con la forma que valida el servidor (los 43 caracteres de base64url). */
const jwk = (seed: string): JsonWebKey => ({
  kty: "EC",
  crv: "P-256",
  x: seed.padEnd(43, "A").slice(0, 43),
  y: seed.padEnd(43, "B").slice(0, 43),
});

const CIPHERTEXT = "A".repeat(32);
const IV = "B".repeat(16);

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

test("cada dispositivo tiene su ranura y publicar en una no pisa la otra", async () => {
  const web = jwk("web");
  const android = jwk("android");
  await repo.changePublicKey("usr_marcos", web, { platform: "web" });

  // Añadir una ranura a una cuenta que ya cifra también pide la contraseña:
  // con una sesión robada se instalaría otra clave sin tocar la existente.
  await assert.rejects(
    () => repo.changePublicKey("usr_marcos", android, { platform: "android" }),
    (error: { status?: number; details?: { newSlot?: boolean } }) => {
      assert.equal(error.status, 428, "el cliente necesita saber que falta confirmar");
      assert.equal(error.details?.newSlot, true, "es una ranura nueva, no una rotación");
      return true;
    },
  );
  await repo.changePublicKey("usr_marcos", android, {
    platform: "android",
    password: "demo1234",
  });

  const keys = repo.listPublicKeyRecords("usr_marcos");
  assert.deepEqual(
    keys.map((key) => key.platform),
    ["web", "android"],
    "la ranura web debe ir primero para los clientes anteriores",
  );
  assert.equal(repo.getPublicKeyRecord("usr_marcos", "web")?.jwk.x, web.x);
  assert.equal(repo.getPublicKeyRecord("usr_marcos", "android")?.jwk.x, android.x);

  // Rotar la ranura del móvil exige contraseña y deja intacta la del navegador.
  const nextAndroid = jwk("android-2");
  await assert.rejects(
    () => repo.changePublicKey("usr_marcos", nextAndroid, { platform: "android" }),
    /contraseña/i,
  );
  await repo.changePublicKey("usr_marcos", nextAndroid, {
    platform: "android",
    password: "demo1234",
  });
  assert.equal(repo.getPublicKeyRecord("usr_marcos", "web")?.jwk.x, web.x);
  assert.equal(repo.getPublicKeyRecord("usr_marcos", "android")?.jwk.x, nextAndroid.x);

  const history = repo.listPublicKeyHistory("usr_marcos");
  assert.ok(history.some((entry) => entry.platform === "android"));
});

test("un mensaje lleva un sobre por cada clave del destinatario", async () => {
  await repo.changePublicKey("usr_diego", jwk("sender"), { platform: "web" });
  await repo.changePublicKey("usr_clara", jwk("clara-web"), { platform: "web" });
  await repo.changePublicKey("usr_clara", jwk("clara-app"), {
    platform: "android",
    password: "demo1234",
  });

  const senderId = repo.getPublicKeyRecord("usr_diego", "web")!.keyId;
  const webId = repo.getPublicKeyRecord("usr_clara", "web")!.keyId;
  const appId = repo.getPublicKeyRecord("usr_clara", "android")!.keyId;

  repo.updateRequestStatus("req_seed_2", "usr_clara", "accepted");
  const message = repo.addEncryptedMessage("req_seed_2", "usr_diego", {
    keyId: senderId,
    envelopes: [
      { keyId: webId, ciphertext: CIPHERTEXT, iv: IV },
      { keyId: appId, ciphertext: CIPHERTEXT, iv: IV },
    ],
  });
  assert.equal(message.envelopes.length, 2);

  const stored = repo
    .listMessages("req_seed_2", "usr_clara")
    .messages.find((item) => item.id === message.id);
  assert.ok(stored, "el mensaje no aparece en el hilo");
  assert.deepEqual(
    stored.envelopes.map((envelope) => envelope.keyId).sort(),
    [webId, appId].sort(),
  );
  assert.equal(stored.ciphertext, null, "un mensaje con sobres no guarda uno suelto");
  assert.equal(stored.keyId, senderId, "la huella guardada es la del remitente");
});

test("el servidor rechaza sobres para claves que no son de la otra persona", async () => {
  const senderId = repo.getPublicKeyRecord("usr_diego", "web")!.keyId;
  assert.throws(
    () =>
      repo.addEncryptedMessage("req_seed_2", "usr_diego", {
        keyId: senderId,
        envelopes: [{ keyId: senderId, ciphertext: CIPHERTEXT, iv: IV }],
      }),
    /no es de la otra persona/,
  );
  assert.throws(
    () =>
      repo.addEncryptedMessage("req_seed_2", "usr_diego", {
        keyId: senderId,
        envelopes: [
          { keyId: repo.getPublicKeyRecord("usr_clara", "web")!.keyId, ciphertext: CIPHERTEXT, iv: IV },
          { keyId: repo.getPublicKeyRecord("usr_clara", "web")!.keyId, ciphertext: CIPHERTEXT, iv: IV },
        ],
      }),
    /dos sobres/,
  );
});

test("el hilo entrega las ranuras de las dos partes", () => {
  const keys = repo.conversationKeys("req_seed_2", "usr_diego");
  assert.ok(keys.me.keys.some((key) => key.platform === "web"));
  assert.ok(keys.peer.keys.some((key) => key.platform === "web"));
  assert.ok(keys.peer.keys.some((key) => key.platform === "android"));
  assert.equal(keys.peer.keyId, repo.getPublicKeyRecord("usr_clara", "web")!.keyId);
});

test("la mensajería directa guarda un sobre por dispositivo", async () => {
  // usr_ana y usr_clara se siguen mutuamente en la muestra.
  await repo.changePublicKey("usr_ana", jwk("ana"), { platform: "web" });
  const senderId = repo.getPublicKeyRecord("usr_ana", "web")!.keyId;
  const webId = repo.getPublicKeyRecord("usr_clara", "web")!.keyId;
  const appId = repo.getPublicKeyRecord("usr_clara", "android")!.keyId;

  const message = repo.sendDirectMessage("usr_ana", "usr_clara", {
    keyId: senderId,
    envelopes: [
      { keyId: webId, ciphertext: CIPHERTEXT, iv: IV },
      { keyId: appId, ciphertext: CIPHERTEXT, iv: IV },
    ],
  });
  assert.equal(message.envelopes.length, 2);

  const thread = repo.directThread("usr_ana", "usr_clara");
  const stored = thread.messages.find((item) => item.id === message.id);
  assert.ok(stored, "el mensaje directo no aparece en el hilo");
  assert.deepEqual(
    stored.envelopes.map((envelope) => envelope.keyId).sort(),
    [webId, appId].sort(),
  );
  assert.deepEqual(
    thread.peer.keys.map((key) => key.platform).sort(),
    ["android", "web"],
  );
});
