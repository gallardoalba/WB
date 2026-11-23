/**
 * Transparencia del directorio de claves.
 *
 * La instantánea no publica qué clave tiene cada cuenta: publica la raíz de
 * Merkle y su firma, y cada cuenta recibe su prueba de inclusión. Lo que se
 * comprueba aquí es que la prueba ata la clave a una raíz firmada y que
 * cualquier cambio —una clave nueva, una línea retocada, una raíz reescrita—
 * se nota.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { getDb } from "../src/lib/db/index.ts";
import * as repo from "../src/lib/repo.ts";
import * as transparency from "../src/lib/transparency.ts";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

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
  // La misma hora a propósito: con dos instantáneas en el mismo milisegundo
  // el desempate debe ser la inserción, no un UUID aleatorio.
  const now = "2099-01-01T00:00:00.000Z";
  const antes = transparency.createKeySnapshot(getDb(), { key: keyPair(), now });

  repo.setPublicKey(id, jwk("carla-nueva"), "rotation");
  const despues = transparency.createKeySnapshot(getDb(), { key: keyPair(), now });

  assert.equal(
    transparency.latestKeySnapshot(getDb())!.id,
    despues.id,
    "con la misma hora gana la última insertada",
  );
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
