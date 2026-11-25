/**
 * Sobres v2 dentro de un mensaje: qué se acepta y qué no.
 *
 * El servidor no puede abrir el cuerpo, así que lo único que decide es a quién
 * va y quién escribe. Eso es justo lo que se prueba aquí: que un tercero no
 * escriba en un hilo ajeno, que el sobre no pueda ir dirigido a un dispositivo
 * de otra cuenta (dejaría al destinatario real sin poder abrirlo), que un
 * dispositivo retirado cancele el envío, que la otra parte reciba un sobre en
 * cada uno de sus aparatos, y que v1 no se cuele donde ya se puede usar v2.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import "./olm-setup.ts";

import * as v2 from "../src/lib/e2e-v2.ts";
import { assertNoV1WhenV2 } from "../src/lib/repo/shared.ts";
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
  assert.equal(
    mensaje.senderDeviceId,
    deAna.deviceId,
    "el mensaje recuerda qué dispositivo lo firmó",
  );
  assert.equal(mensaje.keyId, null, "y `keyId` se queda para la ranura de v1");

  const [guardado] = repo.listMessages(hilo, bruno).messages;
  assert.deepEqual(guardado?.envelopes, [
    { keyId: deBruno.deviceId, ciphertext: "cuerpo-de-libolm", iv: "", protocol: 2, type: 1 },
  ]);
});

test("v1 no se cuela cuando la conversación ya puede usar v2", async () => {
  const casos = [
    { nombre: "solo v2", v1: false, v2: true, error: null },
    {
      nombre: "solo v1",
      v1: true,
      v2: false,
      error: /ya usa el cifrado v2/,
    },
    {
      nombre: "v1 y v2 a la vez",
      v1: true,
      v2: true,
      error: /a la vez sobres de v1 y de v2/,
    },
  ] as const;

  for (const caso of casos) {
    const ana = cuenta(`Ana Mezcla ${caso.nombre}`);
    const bruno = cuenta(`Bruno Mezcla ${caso.nombre}`);
    const deAna = await dispositivo(ana, `dispositivo-de-ana-${caso.nombre}`);
    const deBruno = await dispositivo(bruno, `dispositivo-de-bruno-${caso.nombre}`);
    const hilo = intercambio(ana, bruno);
    const claveAna = repo.setPublicKey(ana, { kty: "EC", crv: "P-256", x: "a".repeat(43), y: "b".repeat(43) });
    const claveBruno = repo.setPublicKey(bruno, { kty: "EC", crv: "P-256", x: "c".repeat(43), y: "d".repeat(43) });

    const enviar = () =>
      repo.addEncryptedMessage(hilo, ana, {
        ...(caso.v1
          ? {
              keyId: claveAna.keyId,
              envelopes: [{ keyId: claveBruno.keyId, ciphertext: "sobre-v1", iv: "iv-v1" }],
            }
          : {}),
        ...(caso.v2
          ? { v2: { senderDeviceId: deAna.deviceId, envelopes: [sobre(deBruno.deviceId)] } }
          : {}),
      });

    if (!caso.error) {
      const mensaje = enviar();
      const [guardado] = repo.listMessages(hilo, ana).messages;
      assert.equal(guardado?.id, mensaje.id, `${caso.nombre}: se guarda`);
      continue;
    }
    // Mezclar dejaría en la base una copia cifrada con la clave estática por
    // conversación, que es justo lo que v2 evita: el servidor no la acepta
    // aunque la interfaz nunca la mande.
    assert.throws(
      enviar,
      (error: { status?: number; message?: string }) =>
        error.status === 409 && caso.error.test(error.message ?? ""),
      `${caso.nombre}: se rechaza`,
    );
    assert.equal(repo.listMessages(hilo, ana).messages.length, 0, `${caso.nombre}: no se guarda nada`);
  }
});

test("la mezcla se rechaza sin depender de que las dos partes tengan v2", async () => {
  const ana = cuenta("Ana Mezcla Seca");
  const bruno = cuenta("Bruno Mezcla Seca");
  // Por el camino normal un sobre de v2 no pasa de la validación si falta un
  // dispositivo, así que la regla se comprueba donde vive: la mezcla se rechaza
  // por sí sola y no porque `bothHaveV2Devices` dé la casualidad de ser cierto.
  assert.throws(
    () => assertNoV1WhenV2(ana, bruno, { hasV1: true, hasV2: true }),
    (error: { status?: number; message?: string }) =>
      error.status === 409 && /a la vez sobres de v1 y de v2/.test(error.message ?? ""),
  );
  // Sin v2 en el mensaje, la decisión vuelve a depender de los dispositivos.
  assert.doesNotThrow(() => assertNoV1WhenV2(ana, bruno, { hasV1: true, hasV2: false }));
});

test("donde la otra persona no tiene v2, v1 sigue valiendo", async () => {
  const ana = cuenta("Ana V1 Suelta");
  const bruno = cuenta("Bruno V1 Suelta");
  const hilo = intercambio(ana, bruno);
  const claveAna = repo.setPublicKey(ana, { kty: "EC", crv: "P-256", x: "a".repeat(43), y: "b".repeat(43) });
  const claveBruno = repo.setPublicKey(bruno, { kty: "EC", crv: "P-256", x: "c".repeat(43), y: "d".repeat(43) });

  const mensaje = repo.addEncryptedMessage(hilo, ana, {
    keyId: claveAna.keyId,
    envelopes: [{ keyId: claveBruno.keyId, ciphertext: "sobre-v1", iv: "iv-v1" }],
  });
  assert.equal(repo.listMessages(hilo, ana).messages[0]?.id, mensaje.id);
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

test("todos los aparatos de la otra parte reciben su sobre", async () => {
  const ana = cuenta("Ana Cobertura");
  const bruno = cuenta("Bruno Cobertura");
  const deAna = await dispositivo(ana, "dispositivo-de-ana-cob1");
  const uno = await dispositivo(bruno, "dispositivo-de-bruno-cob1");
  const dos = await dispositivo(bruno, "dispositivo-de-bruno-cob2");
  const tres = await dispositivo(bruno, "dispositivo-de-bruno-cob3");
  const hilo = intercambio(ana, bruno);

  // Con dos de tres, el tercero se quedaría sin leer el mensaje y nadie se
  // enteraría hasta que lo abriera.
  assert.throws(
    () =>
      repo.addEncryptedMessage(hilo, ana, {
        v2: {
          senderDeviceId: deAna.deviceId,
          envelopes: [sobre(uno.deviceId), sobre(dos.deviceId)],
        },
      }),
    (error: { status?: number; message?: string }) =>
      error.status === 409 && /Faltan sobres/.test(error.message ?? ""),
  );

  repo.addEncryptedMessage(hilo, ana, {
    v2: {
      senderDeviceId: deAna.deviceId,
      envelopes: [sobre(uno.deviceId), sobre(dos.deviceId), sobre(tres.deviceId)],
    },
  });
  assert.equal(repo.listMessages(hilo, bruno).messages.length, 1);
});

test("un aparato nuevo invalida la lista con la que se cifró", async () => {
  const ana = cuenta("Ana Carrera");
  const bruno = cuenta("Bruno Carrera");
  const deAna = await dispositivo(ana, "dispositivo-de-ana-car1");
  const viejo = await dispositivo(bruno, "dispositivo-de-bruno-car1");
  const hilo = intercambio(ana, bruno);
  const sobres = [sobre(viejo.deviceId)];

  repo.addEncryptedMessage(hilo, ana, { v2: { senderDeviceId: deAna.deviceId, envelopes: sobres } });

  // La otra persona añade un aparato entre que el cliente lee la lista y
  // envía: el mensaje se rechaza y se reintenta con la lista nueva, que es
  // mejor que dejarla con un aparato mudo sin avisar.
  const nuevo = await dispositivo(bruno, "dispositivo-de-bruno-car2");
  assert.throws(
    () =>
      repo.addEncryptedMessage(hilo, ana, {
        v2: { senderDeviceId: deAna.deviceId, envelopes: sobres },
      }),
    (error: { status?: number }) => error.status === 409,
  );

  // Con la lista nueva entra, y al retirar el viejo basta con los que quedan.
  repo.addEncryptedMessage(hilo, ana, {
    v2: { senderDeviceId: deAna.deviceId, envelopes: [sobre(viejo.deviceId), sobre(nuevo.deviceId)] },
  });
  repo.revokeDevice(bruno, viejo.deviceId);
  repo.addEncryptedMessage(hilo, ana, {
    v2: { senderDeviceId: deAna.deviceId, envelopes: [sobre(nuevo.deviceId)] },
  });
  assert.equal(repo.listMessages(hilo, bruno).messages.length, 3);
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

test("pasada la fecha de apagado, v1 se rechaza con 410 y v2 sigue entrando", async () => {
  // `E2E_V1_SUNSET` es la única palanca que apaga el cifrado antiguo: sin ella
  // un despliegue se queda como está, y con ella deja de aceptarse un sobre v1.
  // Se prueba con dos cuentas sin dispositivo, que son las únicas a las que v1
  // sigue abierto (la regla anti-degradación ya cubre al resto).
  const ana = cuenta("Ana Apagada");
  const bruno = cuenta("Bruno Apagado");
  const hilo = intercambio(ana, bruno);
  const claveAna = repo.setPublicKey(ana, { kty: "EC", crv: "P-256", x: "m".repeat(43), y: "n".repeat(43) });
  const claveBruno = repo.setPublicKey(bruno, { kty: "EC", crv: "P-256", x: "o".repeat(43), y: "p".repeat(43) });
  const enV1 = () =>
    repo.addEncryptedMessage(hilo, ana, {
      keyId: claveAna.keyId,
      envelopes: [{ keyId: claveBruno.keyId, ciphertext: "v1", iv: "iv" }],
    });

  const anterior = process.env.E2E_V1_SUNSET;
  try {
    process.env.E2E_V1_SUNSET = "2020-01-01T00:00:00.000Z";
    assert.throws(
      enV1,
      (error: { status?: number }) => error.status === 410,
      "un mensaje v1 después de la fecha se rechaza con 410",
    );

    // Una fecha que no se entiende no apaga nada: mejor eso que cortar el
    // servicio por una errata en el entorno.
    process.env.E2E_V1_SUNSET = "el martes";
    assert.equal(enV1().encrypted, true);

    process.env.E2E_V1_SUNSET = "2099-01-01T00:00:00.000Z";
    assert.equal(enV1().encrypted, true, "una fecha futura tampoco corta nada todavía");
  } finally {
    if (anterior === undefined) delete process.env.E2E_V1_SUNSET;
    else process.env.E2E_V1_SUNSET = anterior;
  }
});

test("el apagado de v1 no afecta a los sobres v2", async () => {
  // v1 y v2 se apagan por caminos distintos: el 410 solo mira los sobres del
  // protocolo viejo, así que una conversación en v2 sigue funcionando.
  const ana = cuenta("Ana Apagada V2");
  const bruno = cuenta("Bruno Apagado V2");
  const deAna = await dispositivo(ana, "dispositivo-de-ana-13");
  const deBruno = await dispositivo(bruno, "dispositivo-de-bruno-13");
  const hilo = intercambio(ana, bruno);

  const anterior = process.env.E2E_V1_SUNSET;
  try {
    process.env.E2E_V1_SUNSET = "2020-01-01T00:00:00.000Z";
    const mensaje = repo.addEncryptedMessage(hilo, ana, {
      v2: { senderDeviceId: deAna.deviceId, envelopes: [sobre(deBruno.deviceId, "cuerpo-v2")] },
    });
    assert.equal(mensaje.encrypted, true);
    assert.equal(mensaje.senderDeviceId, deAna.deviceId);
  } finally {
    if (anterior === undefined) delete process.env.E2E_V1_SUNSET;
    else process.env.E2E_V1_SUNSET = anterior;
  }
});

test("el informe de mantenimiento cuenta lo que queda de v1, en los dos buzones", async () => {
  // El número que decide cuándo es seguro poner la fecha: mensajes con sobres
  // v1 en los últimos 30 días. Cuenta intercambios **y** directos, porque la
  // fecha los apaga a la vez.
  const antes = repo.runMaintenance().legacyV1Messages;
  const ana = cuenta("Ana Recuento");
  const bruno = cuenta("Bruno Recuento");
  repo.setFollow(ana, bruno, true);
  repo.setFollow(bruno, ana, true);
  const claveAna = repo.setPublicKey(ana, { kty: "EC", crv: "P-256", x: "q".repeat(43), y: "r".repeat(43) });
  const claveBruno = repo.setPublicKey(bruno, { kty: "EC", crv: "P-256", x: "s".repeat(43), y: "t".repeat(43) });
  repo.sendDirectMessage(ana, bruno, {
    keyId: claveAna.keyId,
    envelopes: [{ keyId: claveBruno.keyId, ciphertext: "v1-directo", iv: "iv" }],
  });

  const despues = repo.runMaintenance().legacyV1Messages;
  assert.equal(despues, antes + 1, "el mensaje directo en v1 también cuenta");
});
