/**
 * Mensajería cifrada de extremo a extremo: sobres por aparato y texto asociado.
 *
 * Lo que se fija aquí es el contrato que comparten navegador y servidor:
 *
 * - la huella de una clave pública es la misma a los dos lados,
 * - un mensaje se cifra una vez por cada aparato del destinatario y cualquiera
 *   de ellos lo abre, pero un aparato ajeno no,
 * - el texto asociado (AAD) ata el sobre al hilo, al remitente y a la clave: si
 *   se mueve a otro hilo deja de descifrar,
 * - los mensajes anteriores a la v40 (un solo sobre sin destinatario) siguen
 *   leyéndose.
 *
 * La parte que toca IndexedDB (la identidad del navegador) se prueba aparte, en
 * `e2e-identity.test.ts`, con un doble del almacén.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import * as e2e from "../src/lib/e2e.ts";
import { keyIdFromJwk as serverKeyId } from "../src/lib/key-id.ts";

type Device = { privateKey: CryptoKey; publicJwk: JsonWebKey; keyId: string };

/** Un par ECDH P-256 como el que genera el navegador al iniciar sesión. */
async function newDevice(): Promise<Device> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk, keyId: await e2e.keyIdFromJwk(publicJwk) };
}

const peer = (device: Device): e2e.RecipientKey => ({
  keyId: device.keyId,
  publicJwk: device.publicJwk,
});

/** Igual que en la app: el AAD nombra hilo, remitente y clave. */
const aadOf = (conversationId: string) => (senderId: string, keyId: string) =>
  e2e.messageAad(conversationId, senderId, keyId);

test("la huella de la clave es la misma en el navegador y en el servidor", async () => {
  const device = await newDevice();
  assert.equal(device.keyId, serverKeyId(device.publicJwk));
  // base64url sin relleno: 32 bytes de SHA-256 → 43 caracteres.
  assert.equal(device.keyId.length, 43);
  assert.match(device.keyId, /^[A-Za-z0-9_-]+$/);
  // Cambiar una coordenada cambia la huella.
  const other = await newDevice();
  assert.notEqual(other.keyId, device.keyId);
});

test("el texto asociado nombra el hilo, el remitente y la clave", () => {
  assert.equal(
    e2e.messageAad("req_1", "usr_ana", "HUELGA"),
    "wanderbibliothek:v1|request:req_1|sender:usr_ana|key:HUELGA",
  );
  assert.equal(
    e2e.directAad("dm:usr_ana:usr_marcos", "usr_ana", "HUELGA"),
    "wanderbibliothek:v1|dm:usr_ana:usr_marcos|sender:usr_ana|key:HUELGA",
  );
});

test("un mensaje con varios sobres usa los guardados y, si no, el heredado", () => {
  const suelto = { keyId: "k1", ciphertext: "c", iv: "i" };
  assert.deepEqual(
    e2e.envelopesOf({
      isMine: false,
      keyId: "k1",
      ciphertext: "viejo",
      iv: "viejo-iv",
      envelopes: [suelto],
    }),
    [suelto],
    "con sobres nuevos se ignoran las columnas antiguas",
  );
  assert.deepEqual(
    e2e.envelopesOf({ isMine: false, keyId: null, ciphertext: "viejo", iv: "viejo-iv" }),
    [{ keyId: "", ciphertext: "viejo", iv: "viejo-iv" }],
  );
  // Una lista vacía cae al sobre heredado; sin nada, no hay sobres.
  assert.deepEqual(
    e2e.envelopesOf({
      isMine: false,
      keyId: "k1",
      ciphertext: "viejo",
      iv: "viejo-iv",
      envelopes: [],
    }),
    [{ keyId: "k1", ciphertext: "viejo", iv: "viejo-iv" }],
  );
  assert.deepEqual(
    e2e.envelopesOf({ isMine: false, keyId: null, ciphertext: null, iv: null }),
    [],
  );
  // Sin IV no hay sobre: el cifrado siempre lo escribe.
  assert.deepEqual(
    e2e.envelopesOf({ isMine: false, keyId: "k1", ciphertext: "viejo", iv: null }),
    [],
  );
});

test("un mensaje cifrado para dos aparatos se abre en los dos", async () => {
  const sender = await newDevice();
  const phone = await newDevice();
  const laptop = await newDevice();
  const conversation = "req_multiaparato";

  const text = "Quedamos el sábado a las 11";
  const envelopes = await e2e.encryptForRecipients(
    sender.privateKey,
    [peer(phone), peer(laptop)],
    conversation,
    text,
    e2e.messageAad(conversation, "usr_remitente", sender.keyId),
  );
  assert.equal(envelopes.length, 2);
  assert.deepEqual(
    envelopes.map((envelope) => envelope.keyId),
    [phone.keyId, laptop.keyId],
  );

  const message = {
    isMine: false,
    keyId: sender.keyId,
    ciphertext: null,
    iv: null,
    envelopes,
  };
  for (const device of [phone, laptop]) {
    const decoded = await e2e.decryptForThread(
      device.privateKey,
      device.keyId,
      [peer(sender)],
      message,
      "usr_remitente",
      conversation,
      aadOf(conversation),
    );
    assert.equal(decoded, text, "cada aparato del destinatario puede abrir su sobre");
  }
});

test("un tercer aparato no abre un sobre dirigido a otro", async () => {
  const sender = await newDevice();
  const destination = await newDevice();
  const intruder = await newDevice();
  const conversation = "req_ajeno";

  const envelopes = await e2e.encryptForRecipients(
    sender.privateKey,
    [peer(destination)],
    conversation,
    "Solo para sus ojos",
    e2e.messageAad(conversation, "usr_remitente", sender.keyId),
  );

  const decoded = await e2e.decryptForThread(
    intruder.privateKey,
    intruder.keyId,
    [peer(sender)],
    { isMine: false, keyId: sender.keyId, ciphertext: null, iv: null, envelopes },
    "usr_remitente",
    conversation,
    aadOf(conversation),
  );
  assert.equal(decoded, null);
});

test("el mensaje está atado a su hilo y a su remitente", async () => {
  const sender = await newDevice();
  const destination = await newDevice();
  const conversation = "req_atado";

  const envelopes = await e2e.encryptForRecipients(
    sender.privateKey,
    [peer(destination)],
    conversation,
    "Nos vemos en la plaza",
    e2e.messageAad(conversation, "usr_remitente", sender.keyId),
  );
  const message = { isMine: false, keyId: sender.keyId, ciphertext: null, iv: null, envelopes };
  const peers: e2e.RecipientKey[] = [peer(sender)];

  // Otro hilo: la clave derivada es distinta y el sobre no abre.
  assert.equal(
    await e2e.decryptForThread(
      destination.privateKey,
      destination.keyId,
      peers,
      message,
      "usr_remitente",
      "req_otro",
      aadOf("req_otro"),
    ),
    null,
  );
  // Reatribuir el mensaje a otra persona rompe el AAD.
  assert.equal(
    await e2e.decryptForThread(
      destination.privateKey,
      destination.keyId,
      peers,
      message,
      "usr_impostor",
      conversation,
      aadOf(conversation),
    ),
    null,
  );
  // Y con el contexto correcto sí abre, para descartar que falle por otra cosa.
  assert.equal(
    await e2e.decryptForThread(
      destination.privateKey,
      destination.keyId,
      peers,
      message,
      "usr_remitente",
      conversation,
      aadOf(conversation),
    ),
    "Nos vemos en la plaza",
  );
});

test("mis propios mensajes se leen con los sobres del destinatario", async () => {
  const me = await newDevice();
  const other = await newDevice();
  const conversation = "req_propio";

  const envelopes = await e2e.encryptForRecipients(
    me.privateKey,
    [peer(other)],
    conversation,
    "Te lo dejo el martes",
    e2e.messageAad(conversation, "usr_yo", me.keyId),
  );

  const decoded = await e2e.decryptForThread(
    me.privateKey,
    me.keyId,
    [peer(other)],
    { isMine: true, keyId: me.keyId, ciphertext: null, iv: null, envelopes },
    "usr_yo",
    conversation,
    aadOf(conversation),
  );
  assert.equal(decoded, "Te lo dejo el martes");
});

test("un mensaje anterior a los sobres por aparato se sigue leyendo", async () => {
  const sender = await newDevice();
  const destination = await newDevice();
  const conversation = "req_heredado";

  const key = await e2e.deriveConversationKey(
    sender.privateKey,
    destination.publicJwk,
    conversation,
  );
  const envelope = await e2e.encryptMessage(
    key,
    "Mensaje de la versión anterior",
    e2e.messageAad(conversation, "usr_remitente", sender.keyId),
  );

  const decoded = await e2e.decryptForThread(
    destination.privateKey,
    destination.keyId,
    [peer(sender)],
    {
      isMine: false,
      keyId: sender.keyId,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
    },
    "usr_remitente",
    conversation,
    aadOf(conversation),
  );
  assert.equal(decoded, "Mensaje de la versión anterior");
});

test("sin sobres no hay nada que descifrar", async () => {
  const me = await newDevice();
  assert.equal(
    await e2e.decryptForThread(
      me.privateKey,
      me.keyId,
      [peer(me)],
      { isMine: true, keyId: me.keyId, ciphertext: null, iv: null, envelopes: [] },
      "usr_yo",
      "req_vacio",
      aadOf("req_vacio"),
    ),
    null,
  );
});

test("una clave pública que no es P-256 se rechaza antes de usarla", async () => {
  const me = await newDevice();
  for (const jwk of [
    { kty: "RSA", crv: "P-256", x: "a", y: "b" },
    { kty: "EC", crv: "P-384", x: "a", y: "b" },
    { kty: "EC", crv: "P-256", y: "b" },
    { kty: "EC", crv: "P-256", x: "a" },
  ] as JsonWebKey[]) {
    await assert.rejects(
      () => e2e.deriveConversationKey(me.privateKey, jwk, "req_invalida"),
      /no es válida/,
    );
  }
});

test("un criptograma manipulado no se descifra", async () => {
  const sender = await newDevice();
  const destination = await newDevice();
  const key = await e2e.deriveConversationKey(
    sender.privateKey,
    destination.publicJwk,
    "req_manipulado",
  );
  const envelope = await e2e.encryptMessage(key, "Texto auténtico");

  assert.equal(await e2e.decryptMessage(key, envelope), "Texto auténtico");
  // Cambiar el último bloque del criptograma rompe la etiqueta GCM.
  const tampered = {
    ...envelope,
    ciphertext: `${envelope.ciphertext.slice(0, -4)}AAAA`,
  };
  assert.equal(await e2e.decryptMessage(key, tampered), null);
  // Un IV de otro tamaño tampoco vale.
  assert.equal(await e2e.decryptMessage(key, { ...envelope, iv: "AAAA" }), null);
});

test("cada solicitud deriva una clave distinta con el mismo par", async () => {
  const sender = await newDevice();
  const destination = await newDevice();
  const first = await e2e.deriveConversationKey(sender.privateKey, destination.publicJwk, "req_1");
  const second = await e2e.deriveConversationKey(sender.privateKey, destination.publicJwk, "req_2");

  const envelope = await e2e.encryptMessage(first, "Solo en req_1");
  assert.equal(await e2e.decryptMessage(first, envelope), "Solo en req_1");
  assert.equal(
    await e2e.decryptMessage(second, envelope),
    null,
    "la clave de otro hilo no abre este mensaje",
  );
});
