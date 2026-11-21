/**
 * Protocolo v2: establecimiento con claves de un solo uso y ratchet.
 *
 * Lo que se fija aquí es lo que la auditoría echaba en falta:
 *
 * - el primer mensaje abre la sesión y solo lo abre el dispositivo destinatario,
 * - la clave de un solo uso se gasta una vez y no vuelve a servir,
 * - un mensaje repetido o manipulado no descifra,
 * - los mensajes desordenados dentro de la ventana sí descifran (el medio de
 *   transporte no garantiza orden),
 * - tras `forget` no queda nada que descifre, y
 * - la cuenta y las sesiones sobreviven a guardarse cifradas.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import * as v2 from "../src/lib/e2e-v2.ts";

type Peer = { account: v2.OlmAccount; bundle: v2.DeviceBundle };

/** Dispositivo con su cuenta y el paquete que publicaría en el servidor. */
async function newDevice(deviceId: string): Promise<Peer> {
  const account = await v2.createAccount(5);
  const pending = v2.oneTimeKeys(account);
  assert.ok(pending.length > 0, "la cuenta debe tener claves de un solo uso");
  v2.markKeysAsPublished(account);
  return {
    account,
    bundle: {
      deviceId,
      ...v2.identityKeys(account),
      oneTimeKey: pending[0].key,
      oneTimeKeyId: pending[0].keyId,
    },
  };
}

/**
 * Establecimiento completo: el iniciador manda el mensaje de pre-clave y el
 * destinatario responde. Hasta que el iniciador recibe algo, libolm sigue
 * marcando sus mensajes como de pre-clave.
 */
async function handshake(from: Peer, to: Peer): Promise<{ sender: v2.OlmSession; receiver: v2.OlmSession }> {
  const sender = await v2.startSession(from.account, to.bundle);
  const first = v2.encrypt(sender, "hola");
  const receiver = await v2.acceptSession(to.account, from.bundle.identityKey, first);
  assert.equal(v2.decrypt(receiver, first), "hola");
  assert.equal(v2.decrypt(sender, v2.encrypt(receiver, "hola de vuelta")), "hola de vuelta");
  return { sender, receiver };
}

test("el primer mensaje abre la sesión y las dos partes la reconocen", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");

  const sender = await v2.startSession(alice.account, bob.bundle);
  const first = v2.encrypt(sender, "¿Nos vemos en la plaza?");
  assert.equal(first.type, 0, "el primer mensaje debe ser de pre-clave");

  const receiver = await v2.acceptSession(bob.account, alice.bundle.identityKey, first);
  assert.equal(v2.decrypt(receiver, first), "¿Nos vemos en la plaza?");
  assert.equal(v2.sessionId(sender), v2.sessionId(receiver), "la sesión es la misma a los dos lados");

  const reply = v2.encrypt(receiver, "A las seis");
  assert.equal(reply.type, 1, "tras el establecimiento el mensaje ya no es de pre-clave");
  assert.equal(v2.decrypt(sender, reply), "A las seis");
});

test("la clave de un solo uso se gasta al aceptar la sesión", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");

  const sender = await v2.startSession(alice.account, bob.bundle);
  await v2.acceptSession(bob.account, alice.bundle.identityKey, v2.encrypt(sender, "hola"));

  const replay = await v2.startSession(alice.account, bob.bundle);
  const reused = v2.encrypt(replay, "la misma clave otra vez");
  await assert.rejects(
    () => v2.acceptSession(bob.account, alice.bundle.identityKey, reused),
    "la cuenta descartó la clave al usarla",
  );
});

test("un mensaje de pre-clave no lo acepta un dispositivo ajeno", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const carol = await newDevice("carol-device");

  const sender = await v2.startSession(alice.account, bob.bundle);
  const first = v2.encrypt(sender, "para bob");

  await assert.rejects(
    () => v2.acceptSession(carol.account, alice.bundle.identityKey, first),
    "la clave de un solo uso pertenece a otro dispositivo",
  );
});

test("repetir un mensaje no descifra dos veces", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const message = v2.encrypt(sender, "única vez");
  assert.equal(v2.decrypt(receiver, message), "única vez");
  assert.throws(() => v2.decrypt(receiver, message), "el ratchet ya gastó esa clave");
});

test("un cuerpo manipulado no descifra", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const message = v2.encrypt(sender, "íntegro");
  const tampered = { type: message.type, body: `${message.body.slice(0, -6)}AAAAAA` };
  assert.throws(() => v2.decrypt(receiver, tampered));
});

test("un mensaje normal no abre una sesión nueva", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const normal = v2.encrypt(sender, "mensaje del ratchet");
  assert.equal(normal.type, 1);
  // libolm no autentica la etiqueta de tipo, así que lo que se comprueba es que
  // no sirve para establecer sesión: solo un mensaje de pre-clave la abre.
  await assert.rejects(() =>
    v2.acceptSession(bob.account, alice.bundle.identityKey, { type: 0, body: normal.body }),
  );
  assert.equal(v2.decrypt(receiver, normal), "mensaje del ratchet");
});

test("los mensajes desordenados descifran dentro de la ventana", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const first = v2.encrypt(sender, "uno");
  const second = v2.encrypt(sender, "dos");
  const third = v2.encrypt(sender, "tres");

  assert.equal(v2.decrypt(receiver, third), "tres");
  assert.equal(v2.decrypt(receiver, first), "uno");
  assert.equal(v2.decrypt(receiver, second), "dos");
});

test("tras olvidar la sesión no queda nada que descifre", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const pending = v2.encrypt(sender, "llega tarde");
  v2.forgetSession(receiver);
  assert.throws(() => v2.decrypt(receiver, pending));
});

test("la cuenta y las sesiones sobreviven a guardarse cifradas", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const restoredAccount = await v2.unpickleAccount(v2.pickleAccount(alice.account, "clave-local"), "clave-local");
  const restoredSender = await v2.unpickleSession(v2.pickleSession(sender, "clave-local"), "clave-local");

  const message = v2.encrypt(restoredSender, "sigo aquí");
  assert.equal(v2.decrypt(receiver, message), "sigo aquí");
  assert.equal(
    v2.sessionId(restoredSender),
    v2.sessionId(sender),
    "la sesión restaurada es la misma",
  );
  assert.equal(
    v2.identityKeys(restoredAccount).identityKey,
    alice.bundle.identityKey,
    "la identidad del dispositivo no cambia al restaurar",
  );
  await assert.rejects(
    () => v2.unpickleAccount(v2.pickleAccount(alice.account, "clave-local"), "otra-clave"),
    "sin la clave local el bote no se abre",
  );
});

test("la capacidad de claves de un solo uso se puede consultar", async () => {
  const capacity = await v2.oneTimeKeyCapacity();
  assert.ok(capacity >= 20, `capacidad inesperada: ${capacity}`);
});
