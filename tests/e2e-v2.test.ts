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
 * - tras `forget` no queda nada que descifre,
 * - la cuenta y las sesiones sobreviven a guardarse cifradas,
 * - el paquete va firmado por el dispositivo, así que un servidor no puede
 *   cambiar la identidad ni la clave de un solo uso, y
 * - el texto va rellenado a bloques y atado a su hilo, así que el tamaño no
 *   revela la longitud y un mensaje movido de conversación se rechaza.
 */
import "./olm-setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import * as v2 from "../src/lib/e2e-v2.ts";

const HILO = "request:rq_1";

type Peer = { account: v2.OlmAccount; keys: v2.DeviceKeys; bundle: v2.DeviceBundle };

/** Dispositivo con su cuenta y el paquete que publicaría en el servidor. */
async function newDevice(deviceId: string): Promise<Peer> {
  const account = await v2.createAccount(5);
  const keys = v2.deviceKeys(account, deviceId);
  const [first] = v2.oneTimeKeys(account, deviceId);
  v2.markKeysAsPublished(account);
  return { account, keys, bundle: { ...keys, oneTimeKey: first! } };
}

/**
 * Establecimiento completo: el iniciador manda el mensaje de pre-clave y el
 * destinatario responde. Hasta que el iniciador recibe algo, libolm sigue
 * marcando sus mensajes como de pre-clave.
 */
async function handshake(from: Peer, to: Peer): Promise<{ sender: v2.OlmSession; receiver: v2.OlmSession }> {
  const sender = await v2.startVerifiedSession(from.account, to.bundle);
  const first = v2.encrypt(sender, { conversation: HILO, text: "hola" });
  const receiver = await v2.acceptSession(to.account, from.keys.identityKey, first);
  assert.equal(v2.decrypt(receiver, first, HILO), "hola");
  const back = v2.encrypt(receiver, { conversation: HILO, text: "hola de vuelta" });
  assert.equal(v2.decrypt(sender, back, HILO), "hola de vuelta");
  return { sender, receiver };
}

test("el primer mensaje abre la sesión y las dos partes la reconocen", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");

  const sender = await v2.startVerifiedSession(alice.account, bob.bundle);
  const first = v2.encrypt(sender, { conversation: HILO, text: "¿Nos vemos en la plaza?" });
  assert.equal(first.type, 0, "el primer mensaje debe ser de pre-clave");

  const receiver = await v2.acceptSession(bob.account, alice.keys.identityKey, first);
  assert.equal(v2.decrypt(receiver, first, HILO), "¿Nos vemos en la plaza?");
  assert.equal(v2.sessionId(sender), v2.sessionId(receiver), "la sesión es la misma a los dos lados");

  const reply = v2.encrypt(receiver, { conversation: HILO, text: "A las seis" });
  assert.equal(reply.type, 1, "tras el establecimiento el mensaje ya no es de pre-clave");
  assert.equal(v2.decrypt(sender, reply, HILO), "A las seis");
});

test("la clave de un solo uso se gasta al aceptar la sesión", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");

  const sender = await v2.startVerifiedSession(alice.account, bob.bundle);
  await v2.acceptSession(
    bob.account,
    alice.keys.identityKey,
    v2.encrypt(sender, { conversation: HILO, text: "hola" }),
  );

  const replay = await v2.startVerifiedSession(alice.account, bob.bundle);
  const reused = v2.encrypt(replay, { conversation: HILO, text: "la misma clave otra vez" });
  await assert.rejects(
    () => v2.acceptSession(bob.account, alice.keys.identityKey, reused),
    "la cuenta descartó la clave al usarla",
  );
});

test("un mensaje de pre-clave no lo acepta un dispositivo ajeno", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const carol = await newDevice("carol-device");

  const sender = await v2.startVerifiedSession(alice.account, bob.bundle);
  const first = v2.encrypt(sender, { conversation: HILO, text: "para bob" });

  await assert.rejects(() =>
    v2.acceptSession(carol.account, alice.keys.identityKey, first),
  );
});

test("repetir un mensaje no descifra dos veces", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const message = v2.encrypt(sender, { conversation: HILO, text: "única vez" });
  assert.equal(v2.decrypt(receiver, message, HILO), "única vez");
  assert.throws(() => v2.decrypt(receiver, message, HILO), "el ratchet ya gastó esa clave");
});

test("un cuerpo manipulado no descifra", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const message = v2.encrypt(sender, { conversation: HILO, text: "íntegro" });
  const tampered = { type: message.type, body: `${message.body.slice(0, -6)}AAAAAA` };
  assert.throws(() => v2.decrypt(receiver, tampered, HILO));
});

test("un mensaje normal no abre una sesión nueva", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const normal = v2.encrypt(sender, { conversation: HILO, text: "mensaje del ratchet" });
  assert.equal(normal.type, 1);
  // libolm no autentica la etiqueta de tipo, así que lo que se comprueba es que
  // no sirve para establecer sesión: solo un mensaje de pre-clave la abre.
  await assert.rejects(() =>
    v2.acceptSession(bob.account, alice.keys.identityKey, { type: 0, body: normal.body }),
  );
  assert.equal(v2.decrypt(receiver, normal, HILO), "mensaje del ratchet");
});

test("un mensaje movido a otro hilo se rechaza", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const message = v2.encrypt(sender, { conversation: "request:rq_1", text: "del hilo uno" });
  // El servidor hostil no puede leerlo, pero sí puede moverlo de columna: la
  // atadura al hilo es lo que impide que el cliente lo muestre en el hilo dos.
  assert.throws(() => v2.decrypt(receiver, message, "request:rq_2"), /otra conversación/);
});

test("el relleno oculta la longitud del mensaje", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const short = v2.encrypt(sender, { conversation: HILO, text: "a" });
  const long = v2.encrypt(sender, { conversation: HILO, text: "x".repeat(80) });
  assert.equal(short.body.length, long.body.length, "los dos caben en el mismo bloque");
  assert.equal(v2.decrypt(receiver, short, HILO), "a");
  assert.equal(v2.decrypt(receiver, long, HILO), "x".repeat(80));

  const huge = v2.encrypt(sender, { conversation: HILO, text: "y".repeat(400) });
  assert.ok(huge.body.length > long.body.length, "un mensaje más largo sí ocupa más bloques");
  assert.equal(v2.decrypt(receiver, huge, HILO), "y".repeat(400));
});

test("el paquete del dispositivo va firmado y se puede contrastar", async () => {
  const alice = await newDevice("alice-device");
  await v2.verifyBundle(alice.bundle);

  const fakeIdentity = await newDevice("impostor-device");
  const swapped: v2.DeviceBundle = {
    ...alice.bundle,
    identityKey: fakeIdentity.keys.identityKey,
  };
  await assert.rejects(() => v2.verifyBundle(swapped), /no está firmado/);

  const swappedKey: v2.DeviceBundle = {
    ...alice.bundle,
    oneTimeKey: { ...alice.bundle.oneTimeKey, key: fakeIdentity.bundle.oneTimeKey.key },
  };
  await assert.rejects(() => v2.verifyBundle(swappedKey), /no la firmó el dispositivo/);

  // Con el par fijado de antes, un paquete legítimo de otro dispositivo se
  // rechaza aunque su firma sea válida.
  await assert.rejects(
    () => v2.verifyBundle(fakeIdentity.bundle, alice.keys),
    /no es el que se conocía/,
  );

  // Y el ataque que importa: el servidor conserva la identidad de Alice, pone
  // su propia clave de firma y su propia clave de un solo uso, y se lo firma
  // todo. Con la identidad anclada sola, esto pasaba.
  const suyo = await newDevice("servidor-malicioso");
  const fabricado: v2.DeviceBundle = {
    ...suyo.bundle,
    deviceId: alice.bundle.deviceId,
    identityKey: alice.bundle.identityKey,
  };
  await assert.rejects(() => v2.verifyBundle(fabricado, alice.keys), /no es el que se conocía/);
  await assert.rejects(() => v2.startVerifiedSession(alice.account, fabricado, alice.keys));
  await assert.rejects(
    () => v2.startVerifiedSession(alice.account, swapped),
    /no está firmado/,
  );
});

test("los mensajes desordenados descifran dentro de la ventana", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const first = v2.encrypt(sender, { conversation: HILO, text: "uno" });
  const second = v2.encrypt(sender, { conversation: HILO, text: "dos" });
  const third = v2.encrypt(sender, { conversation: HILO, text: "tres" });

  assert.equal(v2.decrypt(receiver, third, HILO), "tres");
  assert.equal(v2.decrypt(receiver, first, HILO), "uno");
  assert.equal(v2.decrypt(receiver, second, HILO), "dos");
});

test("tras olvidar la sesión no queda nada que descifre", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const pending = v2.encrypt(sender, { conversation: HILO, text: "llega tarde" });
  v2.forgetSession(receiver);
  assert.throws(() => v2.decrypt(receiver, pending, HILO));
});

test("la cuenta y las sesiones sobreviven a guardarse cifradas", async () => {
  const alice = await newDevice("alice-device");
  const bob = await newDevice("bob-device");
  const { sender, receiver } = await handshake(alice, bob);

  const restoredAccount = await v2.unpickleAccount(v2.pickleAccount(alice.account, "clave-local"), "clave-local");
  const restoredSender = await v2.unpickleSession(v2.pickleSession(sender, "clave-local"), "clave-local");

  const message = v2.encrypt(restoredSender, { conversation: HILO, text: "sigo aquí" });
  assert.equal(v2.decrypt(receiver, message, HILO), "sigo aquí");
  assert.equal(v2.sessionId(restoredSender), v2.sessionId(sender), "la sesión restaurada es la misma");
  assert.equal(
    v2.identityKeys(restoredAccount).identityKey,
    alice.keys.identityKey,
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

test("el tamaño calculado del sobre es un tope y no una estimación corta", async () => {
  const alice = await newDevice("alice-tamano");
  const bob = await newDevice("bob-tamano");
  const { sender } = await handshake(alice, bob);

  // Un texto a medio camino entre «cabe» y «no cabe»: el cuerpo real nunca puede
  // superar lo calculado, o el cliente dejaría pasar envíos que el servidor
  // rechaza con 422.
  const texto = "ñ".repeat(20_000);
  const calculado = v2.envelopeBodyLength(HILO, texto);
  const cuerpo = v2.encrypt(sender, { conversation: HILO, text: texto }).body.length;
  assert.ok(cuerpo <= calculado, `el cuerpo (${cuerpo}) no debe pasar de lo calculado (${calculado})`);

  // Y el límite se aplica donde se decide: antes de tocar el ratchet.
  assert.equal(v2.fitsInEnvelope(HILO, "mensaje normal"), true);
  assert.equal(v2.fitsInEnvelope(HILO, "x".repeat(60_000)), false);
});

test("el presupuesto de tamaño tiene en cuenta todos los dispositivos", () => {
  assert.equal(v2.fitsForDevices(HILO, "mensaje corto", 5), true);
  assert.equal(v2.fitsForDevices(HILO, "x".repeat(10_000), 1), true);
  assert.equal(v2.fitsForDevices(HILO, "x".repeat(10_000), 5), false);
  assert.equal(v2.fitsForDevices(HILO, "x".repeat(48_000), 1), false);
});
