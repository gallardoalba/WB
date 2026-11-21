/**
 * Registro de dispositivos del protocolo v2.
 *
 * El servidor guarda el paquete público de cada dispositivo, **verifica su
 * firma** y entrega las claves de un solo uso de una en una. Lo que se fija
 * aquí:
 *
 * - un paquete real de libolm pasa la validación (el identificador de una clave
 *   de un solo uso es corto: `AAAAAw`, no una clave de 32 bytes),
 * - reponer claves no pide contraseña, pero dar de alta otro dispositivo,
 *   cambiar la identidad o reactivar uno retirado sí,
 * - una firma que no cuadra no se guarda,
 * - reclamar borra la clave en el acto; agotar, revocar y suspender cierran la
 *   puerta,
 * - cambiar la identidad descarta las claves de la cuenta anterior, y
 * - la tabla de claves pendientes tiene tope.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import * as v2 from "../src/lib/e2e-v2.ts";
import { hashPasswordSync } from "../src/lib/password.ts";
import { publishDeviceSchema } from "../src/lib/validation.ts";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

const PASSWORD = "una-contraseña-larga";

/**
 * Un dispositivo de verdad: cuenta libolm, paquete firmado y claves de un solo
 * uso firmadas. Es lo que enviaría el navegador.
 */
async function device(deviceId: string, keys = 3) {
  const account = await v2.createAccount(keys);
  const signed = v2.deviceKeys(account, deviceId);
  const oneTimeKeys = v2.oneTimeKeys(account, deviceId);
  // Lo publicado deja de estar pendiente: es lo que hace el cliente después de
  // que el servidor acepte las claves.
  v2.markKeysAsPublished(account);
  return { account, input: { ...signed, oneTimeKeys } };
}

/** Claves nuevas del **mismo** dispositivo, firmadas por él. */
function replenish(
  account: v2.OlmAccount,
  deviceId: string,
  bundle: { deviceId: string; identityKey: string; signingKey: string; signature: string },
  count: number,
) {
  account.generate_one_time_keys(count);
  return { ...bundle, oneTimeKeys: v2.oneTimeKeys(account, deviceId) };
}

function cuenta(nombre: string): string {
  return repo.createUser({
    name: nombre,
    email: `${nombre.toLowerCase().replaceAll(" ", ".")}@example.org`,
    passwordHash: hashPasswordSync(PASSWORD),
    city: "Stuttgart",
  }).id;
}

const DEVICE_ID = "navegador-de-casa-01";

test("un paquete real de libolm pasa la validación del servidor", async () => {
  const real = await device(DEVICE_ID);
  const parsed = publishDeviceSchema.safeParse(real.input);
  assert.equal(
    parsed.success,
    true,
    parsed.success ? "" : JSON.stringify(parsed.error.issues),
  );
  assert.equal(real.input.oneTimeKeys[0]!.keyId.length, 6, "el id de libolm es corto");
});

test("el primer dispositivo se publica sin contraseña y se listan sus claves", async () => {
  const ana = cuenta("Ana Dispositivos");
  const real = await device(DEVICE_ID);

  const { device: saved, change } = await repo.publishDevice(ana, real.input);
  assert.equal(change, "initial");
  assert.equal(saved.oneTimeKeys, 3);
  assert.equal(saved.revokedAt, null);

  const [listed] = repo.listDevices(ana);
  assert.equal(listed?.deviceId, DEVICE_ID);
  assert.equal(listed?.identityKey, real.input.identityKey);
});

test("reponer claves de un solo uso no pide contraseña y no pierde las pendientes", async () => {
  const bruno = cuenta("Bruno Dispositivos");
  const real = await device(DEVICE_ID);
  await repo.publishDevice(bruno, real.input);

  const { device: saved, change } = await repo.publishDevice(
    bruno,
    replenish(real.account, DEVICE_ID, real.input, 2),
  );
  assert.equal(change, "keys");
  assert.equal(saved.oneTimeKeys, 5, "las tres primeras siguen pendientes");
});

test("un segundo dispositivo, una identidad nueva o una reactivación piden contraseña", async () => {
  const carmen = cuenta("Carmen Dispositivos");
  const primero = await device(DEVICE_ID);
  await repo.publishDevice(carmen, primero.input);

  const segundo = await device("tableta-de-carmen-01");
  await assert.rejects(
    () => repo.publishDevice(carmen, segundo.input),
    (error: { status?: number }) => error.status === 428,
    "añadir otro dispositivo exige contraseña",
  );
  await assert.rejects(
    () => repo.publishDevice(carmen, segundo.input, { password: "no-es" }),
    (error: { status?: number }) => error.status === 403,
  );
  const added = await repo.publishDevice(carmen, segundo.input, { password: PASSWORD });
  assert.equal(added.change, "another");
  assert.equal(repo.listDevices(carmen).length, 2);

  // Rotación: misma ranura, otra identidad. Las claves de la cuenta anterior se
  // descartan porque ya no las puede aceptar nadie.
  const rotado = await device(DEVICE_ID, 4);
  await assert.rejects(
    () => repo.publishDevice(carmen, rotado.input),
    (error: { status?: number }) => error.status === 428,
  );
  const rotated = await repo.publishDevice(carmen, rotado.input, { password: PASSWORD });
  assert.equal(rotated.change, "identity");
  assert.equal(rotated.device.oneTimeKeys, 4, "solo quedan las claves nuevas");

  // Reactivación tras retirar el dispositivo.
  repo.revokeDevice(carmen, DEVICE_ID);
  const otraVez = await device(DEVICE_ID, 2);
  await assert.rejects(
    () => repo.publishDevice(carmen, otraVez.input),
    (error: { status?: number }) => error.status === 428,
    "un dispositivo retirado no puede resucitar solo",
  );
  const reactivated = await repo.publishDevice(carmen, otraVez.input, { password: PASSWORD });
  assert.equal(reactivated.change, "reactivation");
  assert.equal(reactivated.device.revokedAt, null);
});

test("una firma que no cuadra no se guarda", async () => {
  const diego = cuenta("Diego Dispositivos");
  const real = await device(DEVICE_ID);
  const impostor = await device("otro-dispositivo-01");

  await assert.rejects(
    () =>
      repo.publishDevice(diego, {
        ...real.input,
        identityKey: impostor.input.identityKey,
      }),
    (error: { status?: number }) => error.status === 422,
    "el paquete no lo firmó la clave que se publica",
  );

  const [firstKey] = real.input.oneTimeKeys;
  await assert.rejects(
    () =>
      repo.publishDevice(diego, {
        ...real.input,
        oneTimeKeys: [{ ...firstKey!, key: impostor.input.oneTimeKeys[0]!.key }],
      }),
    (error: { status?: number }) => error.status === 422,
    "una clave de un solo uso cambiada no lleva la firma del dispositivo",
  );

  assert.deepEqual(repo.listDevices(diego), [], "nada de eso se guardó");
});

test("reclamar entrega una clave distinta cada vez, con su firma, y las agota", async () => {
  const elena = cuenta("Elena Dispositivos");
  const real = await device(DEVICE_ID, 2);
  await repo.publishDevice(elena, real.input);

  const first = repo.claimOneTimeKey(elena, DEVICE_ID);
  const second = repo.claimOneTimeKey(elena, DEVICE_ID);
  assert.ok(first?.oneTimeKey && second?.oneTimeKey);
  assert.notEqual(first.oneTimeKey.key, second.oneTimeKey.key, "no se reparte la misma clave");
  assert.ok(first.oneTimeKey.signature.length > 0, "la clave viaja firmada");
  assert.equal(first.signature, real.input.signature, "el paquete también");

  const agotado = repo.claimOneTimeKey(elena, DEVICE_ID);
  assert.equal(agotado?.oneTimeKey, null, "el paquete sale sin clave cuando no quedan");
  assert.equal(repo.claimOneTimeKey(elena, "no-existe-000000"), null);
});

test("revocar y suspender cierran la entrega de claves", async () => {
  const fran = cuenta("Fran Dispositivos");
  const real = await device(DEVICE_ID);
  await repo.publishDevice(fran, real.input);

  assert.equal(repo.revokeDevice(fran, DEVICE_ID), true);
  assert.equal(repo.revokeDevice(fran, DEVICE_ID), false, "revocar dos veces no cambia nada");
  assert.deepEqual(repo.listDevices(fran), [], "un dispositivo retirado no se publica");
  assert.equal(repo.claimOneTimeKey(fran, DEVICE_ID), null);
  const revocado = repo.getDevice(fran, DEVICE_ID);
  assert.ok(revocado?.revokedAt, "la fila se conserva para el historial");
  assert.equal(revocado.oneTimeKeys, 0, "las claves pendientes se descartan");

  const gema = cuenta("Gema Dispositivos");
  const suyo = await device("gema-dispositivo-01");
  await repo.publishDevice(gema, suyo.input);
  const { getDb } = await import("../src/lib/db/index.ts");
  getDb()
    .prepare("UPDATE users SET is_suspended = 1, suspension_reason = 'prueba' WHERE id = ?")
    .run(gema);
  assert.deepEqual(repo.listDevices(gema), [], "una cuenta suspendida no publica dispositivos");
  assert.equal(repo.claimOneTimeKey(gema, "gema-dispositivo-01"), null);
});

test("la tabla de claves pendientes tiene tope", async () => {
  const hugo = cuenta("Hugo Dispositivos");
  const real = await device(DEVICE_ID, 120);
  const { device: saved } = await repo.publishDevice(hugo, real.input);
  assert.equal(saved.oneTimeKeys, repo.MAX_ONE_TIME_KEYS);
});

test("el camino completo: publicar, reclamar, verificar y conversar", async () => {
  // Es la prueba que faltaba: cada pieza por separado pasaba, pero nadie unía
  // lo que publica el servidor con lo que el cliente acepta. Si la firma del
  // paquete no llegara intacta al cliente, aquí se rompe.
  const iris = cuenta("Iris Dispositivos");
  const juan = cuenta("Juan Dispositivos");
  const deIris = await device("iris-dispositivo-01", 2);
  const deJuan = await device("juan-dispositivo-02", 2);
  await repo.publishDevice(iris, deIris.input);
  await repo.publishDevice(juan, deJuan.input);

  // Juan quiere escribir a Iris: pide su dispositivo y reclama una clave.
  const [listado] = repo.listDevices(iris);
  assert.equal(listado?.deviceId, "iris-dispositivo-01");
  const bundle = repo.claimOneTimeKey(iris, "iris-dispositivo-01");
  assert.ok(bundle?.oneTimeKey);

  const sesion = await v2.startVerifiedSession(deJuan.account, {
    ...bundle,
    oneTimeKey: bundle.oneTimeKey,
  });
  const primero = v2.encrypt(sesion, { conversation: "request:rq_9", text: "¿Quedamos?" });

  // Iris recibe el mensaje de pre-clave y responde.
  const entrante = await v2.acceptSession(deIris.account, deJuan.input.identityKey, primero);
  assert.equal(v2.decrypt(entrante, primero, "request:rq_9"), "¿Quedamos?");
  const respuesta = v2.encrypt(entrante, { conversation: "request:rq_9", text: "El jueves" });
  assert.equal(v2.decrypt(sesion, respuesta, "request:rq_9"), "El jueves");

  // Y nadie más puede aceptar ese mensaje: la clave ya se gastó.
  const otro = await device("intruso-dispositivo-01");
  await assert.rejects(() => v2.acceptSession(otro.account, deJuan.input.identityKey, primero));
});
