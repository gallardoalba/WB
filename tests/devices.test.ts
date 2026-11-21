/**
 * Registro de dispositivos del protocolo v2.
 *
 * El servidor guarda el paquete público de cada dispositivo y entrega las
 * claves de un solo uso **de una en una**. Lo que se fija aquí:
 *
 * - publicar repone claves sin perder las que quedaban,
 * - reclamar borra la clave en el acto, así que no hay dos sesiones con el
 *   mismo material,
 * - revocar deja de publicar el dispositivo y tira sus claves pendientes,
 * - la rotación de identidad conserva la fecha de alta.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

const KEY_A = "a".repeat(43);
const KEY_B = "b".repeat(43);
const KEY_C = "c".repeat(43);

function cuenta(nombre: string): string {
  return repo.createUser({
    name: nombre,
    email: `${nombre.toLowerCase().replaceAll(" ", ".")}@example.org`,
    passwordHash: "scrypt$1,1,1$sal$hash",
    city: "Stuttgart",
  }).id;
}

/** Los identificadores de clave son únicos por dispositivo, no por envío. */
const dispositivo = (keys: { keyId: string; key: string }[]) => ({
  deviceId: "navegador-de-casa",
  identityKey: KEY_A,
  signingKey: KEY_B,
  oneTimeKeys: keys,
});

test("publicar repone claves de un solo uso sin perder las pendientes", () => {
  const ana = cuenta("Ana Dispositivos");

  const first = repo.publishDevice(ana, dispositivo([
    { keyId: "AAAAA0", key: KEY_A },
    { keyId: "AAAAA1", key: KEY_B },
  ]));
  assert.equal(first.oneTimeKeys, 2);
  assert.equal(first.revokedAt, null);

  const second = repo.publishDevice(ana, dispositivo([{ keyId: "AAAAA2", key: KEY_C }]));
  assert.equal(second.oneTimeKeys, 3, "las claves anteriores siguen pendientes");

  const [listed] = repo.listDevices(ana);
  assert.equal(listed.deviceId, "navegador-de-casa");
  assert.equal(listed.identityKey, KEY_A);
  assert.equal(listed.oneTimeKeys, 3);
});

test("reclamar entrega una clave distinta cada vez y las agota", () => {
  const bruno = cuenta("Bruno Dispositivos");
  repo.publishDevice(bruno, dispositivo([
    { keyId: "AAAAA0", key: KEY_A },
    { keyId: "AAAAA1", key: KEY_B },
  ]));

  const first = repo.claimOneTimeKey(bruno, "navegador-de-casa");
  const second = repo.claimOneTimeKey(bruno, "navegador-de-casa");
  assert.ok(first?.oneTimeKey && second?.oneTimeKey);
  assert.notEqual(first.oneTimeKey.key, second.oneTimeKey.key, "no se reparte la misma clave");

  const agotado = repo.claimOneTimeKey(bruno, "navegador-de-casa");
  assert.equal(agotado?.oneTimeKey, null, "el paquete sale sin clave cuando no quedan");
  assert.equal(repo.claimOneTimeKey(bruno, "otro-dispositivo"), null, "un dispositivo inexistente no da paquete");
});

test("revocar deja de publicar el dispositivo y descarta sus claves", () => {
  const carmen = cuenta("Carmen Dispositivos");
  repo.publishDevice(carmen, dispositivo([
    { keyId: "AAAAA0", key: KEY_A },
    { keyId: "AAAAA1", key: KEY_B },
  ]));

  assert.equal(repo.revokeDevice(carmen, "navegador-de-casa"), true);
  assert.equal(repo.revokeDevice(carmen, "navegador-de-casa"), false, "revocar dos veces no cambia nada");
  assert.deepEqual(repo.listDevices(carmen), [], "un dispositivo retirado no se publica");

  const revocado = repo.getDevice(carmen, "navegador-de-casa");
  assert.ok(revocado?.revokedAt, "la fila se conserva para el historial");
  assert.equal(revocado.oneTimeKeys, 0, "las claves pendientes se descartan");
  assert.equal(repo.claimOneTimeKey(carmen, "navegador-de-casa"), null);
});

test("rotar la identidad conserva la fecha de alta", () => {
  const diego = cuenta("Diego Dispositivos");
  const original = repo.publishDevice(diego, dispositivo([{ keyId: "AAAAA0", key: KEY_A }]));

  const rotado = repo.publishDevice(diego, {
    deviceId: "navegador-de-casa",
    identityKey: KEY_C,
    signingKey: KEY_B,
    oneTimeKeys: [],
  });
  assert.equal(rotado.createdAt, original.createdAt, "el alta no cambia");
  assert.equal(rotado.identityKey, KEY_C, "la identidad sí");
  assert.ok(rotado.updatedAt >= original.updatedAt);
});

test("publicar de nuevo reactiva un dispositivo revocado", () => {
  const elena = cuenta("Elena Dispositivos");
  repo.publishDevice(elena, dispositivo([{ keyId: "AAAAA0", key: KEY_A }]));
  repo.revokeDevice(elena, "navegador-de-casa");

  const reactivado = repo.publishDevice(elena, dispositivo([{ keyId: "AAAAA1", key: KEY_B }]));
  assert.equal(reactivado.revokedAt, null);
  assert.equal(repo.listDevices(elena).length, 1);
});
