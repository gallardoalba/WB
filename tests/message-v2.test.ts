/**
 * Sobres v2 dentro de un mensaje: qué se acepta y qué no.
 *
 * El servidor no puede abrir el cuerpo, así que lo único que decide es a quién
 * va y quién escribe. Eso es justo lo que se prueba aquí: que un tercero no
 * escriba en un hilo ajeno, que el sobre no pueda ir dirigido a un dispositivo
 * de otra cuenta (dejaría al destinatario real sin poder abrirlo), que un
 * dispositivo retirado cancele el envío, y que los dos formatos convivan en el
 * mismo mensaje sin pisarse.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import "./olm-setup.ts";

import * as v2 from "../src/lib/e2e-v2.ts";
import { hashPasswordSync } from "../src/lib/password.ts";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let db: DbModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  db = await import("../src/lib/db/index.ts");
});

const PASSWORD = "una-contraseña-larga";

async function dispositivo(userId: string, deviceId: string) {
  const account = await v2.createAccount(2);
  const signed = v2.deviceKeys(account, deviceId);
  const oneTimeKeys = v2.oneTimeKeys(account, deviceId);
  await repo.publishDevice(
    userId,
    { ...signed, oneTimeKeys },
    { password: PASSWORD },
  );
  return { account, deviceId, signed };
}

function cuenta(nombre: string): string {
  return repo.createUser({
    name: nombre,
    email: `${nombre.toLowerCase().replaceAll(" ", ".")}@example.org`,
    passwordHash: hashPasswordSync(PASSWORD),
    city: "Stuttgart",
  }).id;
}

function intercambio(ana: string, bruno: string): string {
  const conexion = db.getDb();
  const listing = conexion.prepare("SELECT id FROM listings LIMIT 1").get() as { id: string };
  const id = `rq_${ana.slice(-4)}${bruno.slice(-4)}`;
  conexion
    .prepare(
      `INSERT INTO requests (id, listing_id, requester_id, owner_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'accepted', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(id, listing.id, ana, bruno);
  return id;
}

/** Un sobre v2 con la forma que exige el servidor. */
const sobre = (recipientDeviceId: string, body = "AAAA") => ({ recipientDeviceId, type: 1, body });

test("un mensaje v2 se guarda y se devuelve con su protocolo", async () => {
  const ana = cuenta("Ana Sobres");
  const bruno = cuenta("Bruno Sobres");
  const deAna = await dispositivo(ana, "dispositivo-de-ana-01");
  const deBruno = await dispositivo(bruno, "dispositivo-de-bruno-1");
  const hilo = intercambio(ana, bruno);

  const mensaje = repo.addEncryptedMessage(hilo, ana, {
    v2: {
      senderDeviceId: deAna.deviceId,
      envelopes: [sobre(deBruno.deviceId, "cuerpo-de-libolm")],
    },
  });
  assert.equal(mensaje.encrypted, true);
  assert.equal(mensaje.keyId, deAna.deviceId, "el mensaje recuerda qué dispositivo lo firmó");

  const [guardado] = repo.listMessages(hilo, bruno).messages;
  assert.deepEqual(guardado?.envelopes, [
    { keyId: deBruno.deviceId, ciphertext: "cuerpo-de-libolm", iv: "", protocol: 2, type: 1 },
  ]);
});

test("los dos formatos caben en el mismo mensaje", async () => {
  const ana = cuenta("Ana Doble");
  const bruno = cuenta("Bruno Doble");
  const deAna = await dispositivo(ana, "dispositivo-de-ana-02");
  const deBruno = await dispositivo(bruno, "dispositivo-de-bruno-2");
  const hilo = intercambio(ana, bruno);
  const claveAna = repo.setPublicKey(ana, { kty: "EC", crv: "P-256", x: "a".repeat(43), y: "b".repeat(43) });
  const claveBruno = repo.setPublicKey(bruno, { kty: "EC", crv: "P-256", x: "c".repeat(43), y: "d".repeat(43) });

  const mensaje = repo.addEncryptedMessage(hilo, ana, {
    keyId: claveAna.keyId,
    envelopes: [{ keyId: claveBruno.keyId, ciphertext: "sobre-v1", iv: "iv-v1" }],
    v2: { senderDeviceId: deAna.deviceId, envelopes: [sobre(deBruno.deviceId)] },
  });

  const [guardado] = repo.listMessages(hilo, ana).messages;
  assert.equal(guardado?.id, mensaje.id);
  const protocolos = guardado!.envelopes.map((envelope) => envelope.protocol ?? 1).sort();
  assert.deepEqual(protocolos, [1, 2], "uno de cada: así leen los clientes viejos y los nuevos");
});

test("un tercero no escribe en un hilo ajeno", async () => {
  const ana = cuenta("Ana Tercera");
  const bruno = cuenta("Bruno Tercero");
  const carla = cuenta("Carla Tercera");
  await dispositivo(ana, "dispositivo-de-ana-03");
  const deBruno = await dispositivo(bruno, "dispositivo-de-bruno-3");
  const deCarla = await dispositivo(carla, "dispositivo-de-carla-03");
  const hilo = intercambio(ana, bruno);

  assert.throws(
    () =>
      repo.addEncryptedMessage(hilo, carla, {
        v2: { senderDeviceId: deCarla.deviceId, envelopes: [sobre(deBruno.deviceId)] },
      }),
    "quien no participa no escribe",
  );
});

test("el sobre no puede ir a un dispositivo de otra cuenta", async () => {
  const ana = cuenta("Ana Destino");
  const bruno = cuenta("Bruno Destino");
  const carla = cuenta("Carla Destino");
  const deAna = await dispositivo(ana, "dispositivo-de-ana-04");
  await dispositivo(bruno, "dispositivo-de-bruno-4");
  const deCarla = await dispositivo(carla, "dispositivo-de-carla-04");
  const hilo = intercambio(ana, bruno);

  // Sin esta comprobación, el mensaje se guardaría «para Carla» y Bruno no
  // podría abrirlo nunca.
  assert.throws(
    () =>
      repo.addEncryptedMessage(hilo, ana, {
        v2: {
          senderDeviceId: deAna.deviceId,
          envelopes: [sobre(deCarla.deviceId, "para-carla")],
        },
      }),
    (error: { status?: number }) => error.status === 409,
  );
});

test("un dispositivo retirado o ajeno no puede firmar el envío", async () => {
  const ana = cuenta("Ana Firma");
  const bruno = cuenta("Bruno Firma");
  const deAna = await dispositivo(ana, "dispositivo-de-ana-05");
  const deBruno = await dispositivo(bruno, "dispositivo-de-bruno-5");
  const hilo = intercambio(ana, bruno);

  repo.revokeDevice(ana, deAna.deviceId);
  assert.throws(
    () =>
      repo.addEncryptedMessage(hilo, ana, {
        v2: { senderDeviceId: deAna.deviceId, envelopes: [sobre(deBruno.deviceId)] },
      }),
    (error: { status?: number }) => error.status === 409,
    "un dispositivo retirado no escribe",
  );

  // Y tampoco se puede usar el dispositivo de otra persona como propio.
  assert.throws(
    () =>
      repo.addEncryptedMessage(hilo, ana, {
        v2: { senderDeviceId: deBruno.deviceId, envelopes: [sobre(deBruno.deviceId)] },
      }),
    (error: { status?: number }) => error.status === 409,
  );
});

test("dos sobres al mismo dispositivo se rechazan", async () => {
  const ana = cuenta("Ana Duplicado");
  const bruno = cuenta("Bruno Duplicado");
  const deAna = await dispositivo(ana, "dispositivo-de-ana-06");
  const deBruno = await dispositivo(bruno, "dispositivo-de-bruno-6");
  const hilo = intercambio(ana, bruno);

  assert.throws(
    () =>
      repo.addEncryptedMessage(hilo, ana, {
        v2: {
          senderDeviceId: deAna.deviceId,
          envelopes: [sobre(deBruno.deviceId, "uno"), sobre(deBruno.deviceId, "dos")],
        },
      }),
    (error: { status?: number }) => error.status === 400,
  );
  assert.deepEqual(repo.listMessages(hilo, ana).messages, [], "no se guardó nada");
});

test("una cuenta suspendida no manda ni recibe sobres v2", async () => {
  const ana = cuenta("Ana Suspende");
  const bruno = cuenta("Bruno Suspende");
  const deAna = await dispositivo(ana, "dispositivo-de-ana-07");
  const deBruno = await dispositivo(bruno, "dispositivo-de-bruno-7");
  const hilo = intercambio(ana, bruno);

  db.getDb().prepare("UPDATE users SET is_suspended = 1 WHERE id = ?").run(bruno);
  assert.throws(
    () =>
      repo.addEncryptedMessage(hilo, ana, {
        v2: { senderDeviceId: deAna.deviceId, envelopes: [sobre(deBruno.deviceId)] },
      }),
    (error: { status?: number }) => error.status === 409,
    "el destinatario suspendido no recibe",
  );
});

test("el hilo directo acepta v2 con las mismas reglas", async () => {
  const ana = cuenta("Ana Directo");
  const bruno = cuenta("Bruno Directo");
  const deAna = await dispositivo(ana, "dispositivo-de-ana-08");
  const deBruno = await dispositivo(bruno, "dispositivo-de-bruno-8");
  repo.setFollow(ana, bruno, true);
  repo.setFollow(bruno, ana, true);

  const enviado = repo.sendDirectMessage(ana, bruno, {
    v2: { senderDeviceId: deAna.deviceId, envelopes: [sobre(deBruno.deviceId, "directo")] },
  });
  assert.equal(enviado.encrypted, true);
  const hilo = repo.directThread(bruno, ana);
  assert.equal(hilo.peer.id, ana);
  const mensajes = repo.listDirectMessages(hilo.id, bruno);
  assert.equal(mensajes[0]?.id, enviado.id);
  assert.deepEqual(mensajes[0]?.envelopes.map((envelope) => envelope.protocol), [2]);
});

test("con dispositivos en los dos lados, un mensaje solo v1 se rechaza", async () => {
  // La regla anti-degradación: donde los dos pueden usar v2, el servidor no
  // acepta que la conversación se quede en v1 sin forward secrecy.
  const ana = cuenta("Ana Degrada");
  const bruno = cuenta("Bruno Degrada");
  await dispositivo(ana, "dispositivo-de-ana-09");
  await dispositivo(bruno, "dispositivo-de-bruno-9");
  const hilo = intercambio(ana, bruno);
  const claveAna = repo.setPublicKey(ana, { kty: "EC", crv: "P-256", x: "e".repeat(43), y: "f".repeat(43) });
  const claveBruno = repo.setPublicKey(bruno, { kty: "EC", crv: "P-256", x: "g".repeat(43), y: "h".repeat(43) });

  assert.throws(
    () =>
      repo.addEncryptedMessage(hilo, ana, {
        keyId: claveAna.keyId,
        envelopes: [{ keyId: claveBruno.keyId, ciphertext: "solo-v1", iv: "iv" }],
      }),
    (error: { status?: number }) => error.status === 409,
    "no se acepta un mensaje sin sobres v2 cuando los dos tienen dispositivo",
  );
});

test("sin dispositivo en el remitente, v1 sigue valiendo", async () => {
  // Quien no tiene dispositivo no puede hacer más: se le deja escribir en v1
  // para no dejarlo mudo, pero en cuanto publique uno la regla se aplica.
  const ana = cuenta("Ana Vieja");
  const bruno = cuenta("Bruno Nuevo");
  await dispositivo(bruno, "dispositivo-de-bruno-10");
  const hilo = intercambio(ana, bruno);
  const claveAna = repo.setPublicKey(ana, { kty: "EC", crv: "P-256", x: "i".repeat(43), y: "j".repeat(43) });
  const claveBruno = repo.setPublicKey(bruno, { kty: "EC", crv: "P-256", x: "k".repeat(43), y: "l".repeat(43) });

  const mensaje = repo.addEncryptedMessage(hilo, ana, {
    keyId: claveAna.keyId,
    envelopes: [{ keyId: claveBruno.keyId, ciphertext: "v1-permitido", iv: "iv" }],
  });
  assert.equal(mensaje.encrypted, true);
});
