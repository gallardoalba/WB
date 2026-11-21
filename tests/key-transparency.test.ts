/**
 * Transparencia del directorio de claves.
 *
 * La instantánea no publica qué clave tiene cada cuenta: publica la raíz de
 * Merkle y su firma, y cada cuenta recibe su prueba de inclusión. Lo que se
 * comprueba aquí es que la prueba ata la clave a una raíz firmada y que
 * cualquier cambio —una clave nueva, una línea retocada, una raíz reescrita—
 * se nota.
 */
import "./olm-setup.ts";

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { getDb } from "../src/lib/db/index.ts";
import * as repo from "../src/lib/repo.ts";
import * as transparency from "../src/lib/transparency.ts";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import "./olm-setup.ts";

const keyPair = () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const base64 = Buffer.from(privateKey.export({ format: "der", type: "pkcs8" })).toString("base64");
  return transparency.signingKey(base64)!;
};

const jwk = (x: string) => ({ kty: "EC", crv: "P-256", x, y: "y-" + x });

/** Las claves cuelgan de `users`: cada prueba necesita cuentas de verdad. */
function cuenta(nombre: string): string {
  return repo.createUser({
    name: nombre,
    email: `${nombre.toLowerCase()}@example.org`,
    passwordHash: "scrypt$1,1,1$sal$hash",
    city: "Stuttgart",
  }).id;
}

test("la instantánea firma la raíz del directorio y la prueba de inclusión cuadra", () => {
  const ana = cuenta("Ana Transparente");
  const bruno = cuenta("Bruno Transparente");
  repo.setPublicKey(ana, jwk("ana"), "initial");
  repo.setPublicKey(bruno, jwk("bruno"), "initial");

  const key = keyPair();
  const snapshot = transparency.createKeySnapshot(getDb(), { key });
  assert.equal(snapshot.itemCount, 2, "una línea por clave publicada");
  assert.ok(snapshot.signature, "la instantánea va firmada");
  assert.equal(transparency.verifyKeySnapshotSignature(snapshot), true);

  const proof = transparency.keyInclusion(ana)!;
  assert.equal(proof.snapshotId, snapshot.id);
  assert.match(proof.line, new RegExp(`^${ana}\\|web\\|`));
  assert.equal(
    transparency.verifyMerkleBranch(proof.line, proof.index, proof.branch, proof.root),
    true,
    "la rama lleva de la línea a la raíz",
  );

  // Una línea distinta (otra clave) no valida contra la misma rama.
  const ajena = proof.line.replace(/\|[^|]+$/, "|2026-01-01T00:00:00.000Z");
  assert.equal(
    transparency.verifyMerkleBranch(ajena, proof.index, proof.branch, proof.root),
    false,
  );
});

test("rotar una clave cambia la raíz y la prueba nueva cuadra", () => {
  const id = cuenta("Carla Transparente");
  repo.setPublicKey(id, jwk("carla"), "initial");
  const antes = transparency.createKeySnapshot(getDb(), { key: keyPair() });

  repo.setPublicKey(id, jwk("carla-nueva"), "rotation");
  const despues = transparency.createKeySnapshot(getDb(), { key: keyPair() });

  assert.notEqual(despues.merkleRoot, antes.merkleRoot, "la rotación se ve en la raíz");
  assert.equal(despues.previousRoot, antes.merkleRoot, "la cadena enlaza con la anterior");
  const proof = transparency.keyInclusion(id)!;
  // La línea lleva la huella (`keyId`), no la coordenada `x` del JWK.
  assert.ok(proof.line.includes(repo.getPublicKeyRecord(id)!.keyId));
  assert.equal(transparency.verifyMerkleBranch(proof.line, proof.index, proof.branch, proof.root), true);
});

test("una instantánea retocada deja de verificar", () => {
  const snapshot = transparency.createKeySnapshot(getDb(), { key: keyPair() });
  const retocada = { ...snapshot, createdAt: "2030-01-01T00:00:00.000Z" };
  assert.equal(transparency.verifyKeySnapshotSignature(retocada), false);

  const sinFirma = { ...snapshot, signature: null };
  assert.equal(transparency.verifyKeySnapshotSignature(sinFirma), false);
});

test("sin clave de firma la instantánea se publica sin firma y lo dice", () => {
  const snapshot = transparency.createKeySnapshot(getDb(), { key: null });
  assert.equal(snapshot.signature, null);
  assert.equal(snapshot.signer, null);
  assert.equal(transparency.verifyKeySnapshotSignature(snapshot), false);
});

test("la prueba no existe para una cuenta sin clave publicada", () => {
  transparency.createKeySnapshot(getDb(), { key: keyPair() });
  assert.equal(transparency.keyInclusion("usr_no_existe"), null);
});

test("el índice público solo publica raíces, nunca las líneas del directorio", async () => {
  transparency.createKeySnapshot(getDb(), { key: keyPair() });
  const route = await import("../src/app/api/transparency/keys/route.ts");
  const response = await route.GET(
    new Request("http://localhost:3100/api/transparency/keys"),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { snapshots: Record<string, unknown>[] };
  assert.ok(body.snapshots.length >= 1);
  const texto = JSON.stringify(body);
  assert.doesNotMatch(texto, /\|web\|/, "las líneas no salen por la API pública");
  assert.match(texto, /merkleRoot/);
});

test("con un número impar de claves la prueba del último tramo cuadra", () => {
  // El árbol promueve el nodo impar sin duplicarlo: si la rama no anota de qué
  // lado va cada hermano, el último elemento da una raíz distinta. Este caso
  // (tres o cinco hojas) es el que se escapó en la primera versión.
  const lineas = ["a", "b", "c", "d", "e"];
  const root = transparency.merkleRoot(lineas);
  for (let index = 0; index < lineas.length; index += 1) {
    const branch = transparency.merkleBranch(lineas, index);
    assert.equal(
      transparency.verifyMerkleBranch(lineas[index]!, index, branch, root),
      true,
      `la hoja ${index} no llega a la raíz`,
    );
  }
  const branch = transparency.merkleBranch(lineas, 4);
  assert.equal(
    transparency.verifyMerkleBranch("otra", 4, branch, root),
    false,
    "una hoja distinta no valida",
  );
});

test("dos instantáneas en el mismo milisegundo no desordenan la cadena", () => {
  // En una máquina rápida —pasó en Integración Continua— las dos caen en el
  // mismo `created_at`, y con el id aleatorio como desempate «la última» era
  // cualquiera: la prueba de inclusión devolvía la clave anterior.
  const id = cuenta("Dora Transparente");
  const momento = "2026-12-01T10:00:00.000Z";
  const key = keyPair();
  repo.setPublicKey(id, jwk("dora"), "initial");
  const antes = transparency.createKeySnapshot(getDb(), { key, now: momento });
  repo.setPublicKey(id, jwk("dora-nueva"), "rotation");
  const despues = transparency.createKeySnapshot(getDb(), { key, now: momento });

  assert.equal(
    transparency.latestKeySnapshot(getDb())?.id,
    despues.id,
    "la última es la que se creó después",
  );
  assert.equal(despues.previousRoot, antes.merkleRoot, "y enlaza con la anterior");
  const proof = transparency.keyInclusion(id)!;
  assert.ok(proof.line.includes(repo.getPublicKeyRecord(id)!.keyId));
});

test("las claves de dispositivo entran en el directorio firmado", async () => {
  // Sin esto, la especificación prometía que una sustitución de dispositivo «se
  // detecta por transparencia» cuando las claves de dispositivo no estaban en
  // ninguna instantánea.
  const v2 = await import("../src/lib/e2e-v2.ts");
  const id = cuenta("Eva Dispositivos");
  const account = await v2.createAccount(2);
  const deviceId = "eva-dispositivo-01";
  const signed = v2.deviceKeys(account, deviceId);
  await repo.publishDevice(id, { ...signed, oneTimeKeys: v2.oneTimeKeys(account, deviceId) });

  const lineas = transparency.keyDirectoryLines(getDb());
  const propia = lineas.find((line) => line.startsWith(`${id}|device:${deviceId}|`));
  assert.ok(propia, "el dispositivo debe estar en el directorio");
  assert.ok(propia.includes(signed.identityKey), "con su clave de identidad, para poder compararla");

  // Fecha posterior a la del caso anterior, que fija una marca en el futuro:
  // «la última» es por fecha y luego por orden de inserción.
  const snapshot = transparency.createKeySnapshot(getDb(), {
    key: keyPair(),
    now: "2027-01-01T00:00:00.000Z",
  });
  const proof = transparency.keyInclusion(id, `device:${deviceId}`)!;
  assert.equal(proof.snapshotId, snapshot.id);
  assert.equal(
    transparency.verifyMerkleBranch(proof.line, proof.index, proof.branch, proof.root),
    true,
    "y con prueba de inclusión contra la raíz firmada",
  );
});
