/**
 * Transporte de sobres v2: quién puede escribir en un hilo y quién recibe qué.
 *
 * El servidor no abre ningún cuerpo —eso ya lo fija `e2e-v2.test.ts`—, así que
 * lo que se prueba aquí es lo que sí decide: que un tercero no escriba en una
 * conversación ajena, que un dispositivo no reciba el sobre de otro, que el
 * lote sea todo o nada, y que confirmar borre de verdad.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

import * as v2 from "../src/lib/e2e-v2.ts";
import { hashPasswordSync } from "../src/lib/password.ts";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let db: DbModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  db = await import("../src/lib/db/index.ts");
});

const PASSWORD = "una-contraseña-larga";
const DEVICE_A = "dispositivo-de-ana-01";
const DEVICE_B = "dispositivo-de-bruno-1";

function cuenta(nombre: string): string {
  return repo.createUser({
    name: nombre,
    email: `${nombre.toLowerCase().replaceAll(" ", ".")}@example.org`,
    passwordHash: hashPasswordSync(PASSWORD),
    city: "Stuttgart",
  }).id;
}

/**
 * Dispositivo de verdad: el registro verifica la firma del paquete. El segundo
 * dispositivo de una cuenta pide contraseña, como debe.
 */
async function dispositivo(userId: string, deviceId: string): Promise<void> {
  const account = await v2.createAccount(1);
  const signed = v2.deviceKeys(account, deviceId);
  await repo.publishDevice(
    userId,
    { ...signed, oneTimeKeys: v2.oneTimeKeys(account, deviceId) },
    { password: PASSWORD },
  );
}

/** Hilo de intercambio entre dos cuentas, con un ejemplar cualquiera. */
function intercambio(ana: string, bruno: string): string {
  const conexion = db.getDb();
  const listing = conexion
    .prepare("SELECT id FROM listings LIMIT 1")
    .get() as { id: string } | undefined;
  const id = `rq_${ana.slice(-4)}${bruno.slice(-4)}`;
  conexion
    .prepare(
      `INSERT INTO requests (id, listing_id, requester_id, owner_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'accepted', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(id, listing!.id, ana, bruno);
  return `request:${id}`;
}

const sobre = (recipientDeviceId: string, body = "AAAA") => ({ recipientDeviceId, type: 1 as const, body });

test("quien escribe participa en el hilo y el destinatario es la otra parte", async () => {
  const ana = cuenta("Ana Sobres");
  const bruno = cuenta("Bruno Sobres");
  const carla = cuenta("Carla Sobres");
  await dispositivo(ana, DEVICE_A);
  await dispositivo(bruno, DEVICE_B);
  await dispositivo(carla, "dispositivo-de-carla-01");
  const hilo = intercambio(ana, bruno);

  assert.equal(repo.conversationPeer(hilo, ana), bruno);
  assert.equal(repo.conversationPeer(hilo, bruno), ana);
  assert.equal(repo.conversationPeer(hilo, carla), null, "quien no participa no ve el hilo");
  assert.equal(repo.conversationPeer("dm:no-existe", ana), null);

  const guardados = repo.storeEnvelopes(ana, DEVICE_A, hilo, [sobre(DEVICE_B)]);
  assert.equal(guardados, 1);

  // Carla no puede escribir en un hilo que no es suyo, ni reclamar sus sobres.
  assert.throws(() => repo.storeEnvelopes(carla, "dispositivo-de-carla-01", hilo, [sobre(DEVICE_B)]));
  assert.throws(() =>
    repo.listEnvelopes(carla, "dispositivo-de-carla-01", hilo),
  );
});

test("cada dispositivo recibe solo lo suyo y confirmar lo borra", async () => {
  const ana = cuenta("Ana Buzón");
  const bruno = cuenta("Bruno Buzón");
  await dispositivo(ana, DEVICE_A);
  const segundo = "dispositivo-de-bruno-2";
  await dispositivo(bruno, DEVICE_B);
  await dispositivo(bruno, segundo);
  const hilo = intercambio(ana, bruno);

  repo.storeEnvelopes(ana, DEVICE_A, hilo, [sobre(DEVICE_B, "cuerpo-uno"), sobre(segundo, "cuerpo-dos")]);

  const delPrimero = repo.listEnvelopes(bruno, DEVICE_B, hilo);
  const delSegundo = repo.listEnvelopes(bruno, segundo, hilo);
  assert.deepEqual(delPrimero.map((e) => e.body), ["cuerpo-uno"]);
  assert.deepEqual(delSegundo.map((e) => e.body), ["cuerpo-dos"]);
  assert.equal(delPrimero[0]?.senderDeviceId, DEVICE_A, "el receptor sabe qué dispositivo firmó");
  assert.equal(repo.countPendingEnvelopes(bruno, DEVICE_B), 1);

  assert.equal(repo.ackEnvelopes(bruno, DEVICE_B, [delPrimero[0]!.id]), 1);
  assert.deepEqual(repo.listEnvelopes(bruno, DEVICE_B, hilo), [], "confirmado es borrado");
  assert.equal(repo.ackEnvelopes(bruno, DEVICE_B, [delPrimero[0]!.id]), 0, "confirmar dos veces no falla");
  assert.equal(repo.ackEnvelopes(bruno, segundo, [delPrimero[0]!.id]), 0, "no se borra lo de otro dispositivo");
});

test("el lote es todo o nada: un dispositivo retirado lo cancela", async () => {
  const ana = cuenta("Ana Lote");
  const bruno = cuenta("Bruno Lote");
  await dispositivo(ana, DEVICE_A);
  await dispositivo(bruno, DEVICE_B);
  const retirado = "dispositivo-de-bruno-3";
  await dispositivo(bruno, retirado);
  repo.revokeDevice(bruno, retirado);
  const hilo = intercambio(ana, bruno);

  assert.throws(
    () => repo.storeEnvelopes(ana, DEVICE_A, hilo, [sobre(DEVICE_B, "uno"), sobre(retirado, "dos")]),
    (error: { status?: number }) => error.status === 409,
  );
  assert.deepEqual(repo.listEnvelopes(bruno, DEVICE_B, hilo), [], "no se guardó ni la mitad buena");
});

test("un dispositivo del remitente que no es suyo no puede escribir", async () => {
  const ana = cuenta("Ana Suplantación");
  const bruno = cuenta("Bruno Suplantación");
  await dispositivo(bruno, DEVICE_B);
  const hilo = intercambio(ana, bruno);
  // Ana no ha publicado dispositivo: no puede mandar «como» uno inventado.
  assert.throws(
    () => repo.storeEnvelopes(ana, DEVICE_A, hilo, [sobre(DEVICE_B)]),
    (error: { status?: number }) => error.status === 403,
  );
});

test("el hilo directo también vale, y uno suspendido no recibe sobres", async () => {
  const ana = cuenta("Ana Directo");
  const bruno = cuenta("Bruno Directo");
  await dispositivo(ana, DEVICE_A);
  await dispositivo(bruno, DEVICE_B);
  const conexion = db.getDb();
  conexion
    .prepare(
      `INSERT INTO dm_threads (id, user_a, user_b, created_at)
       VALUES ('dm_prueba', ?, ?, '2026-01-01T00:00:00.000Z')`,
    )
    .run(ana, bruno);

  assert.equal(repo.storeEnvelopes(ana, DEVICE_A, "dm:dm_prueba", [sobre(DEVICE_B)]), 1);
  assert.equal(repo.listEnvelopes(bruno, DEVICE_B, "dm:dm_prueba").length, 1);

  conexion.prepare("UPDATE users SET is_suspended = 1 WHERE id = ?").run(ana);
  assert.throws(
    () => repo.storeEnvelopes(ana, DEVICE_A, "dm:dm_prueba", [sobre(DEVICE_B)]),
    (error: { status?: number }) => error.status === 403,
    "una cuenta suspendida no escribe",
  );
});

test("la retención purga solo lo viejo", async () => {
  const ana = cuenta("Ana Purga");
  const bruno = cuenta("Bruno Purga");
  await dispositivo(ana, DEVICE_A);
  await dispositivo(bruno, DEVICE_B);
  const hilo = intercambio(ana, bruno);
  repo.storeEnvelopes(ana, DEVICE_A, hilo, [sobre(DEVICE_B, "viejo")]);
  repo.storeEnvelopes(ana, DEVICE_A, hilo, [sobre(DEVICE_B, "nuevo")]);

  const conexion = db.getDb();
  const [viejo] = repo.listEnvelopes(bruno, DEVICE_B, hilo);
  conexion
    .prepare("UPDATE device_envelopes SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
    .run(viejo!.id);

  assert.equal(repo.purgeOldEnvelopes(conexion, 30), 1);
  assert.deepEqual(repo.listEnvelopes(bruno, DEVICE_B, hilo).map((e) => e.body), ["nuevo"]);
});
