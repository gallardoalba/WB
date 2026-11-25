/**
 * Comprobación del directorio firmado en el cliente.
 *
 * El paquete de un dispositivo se firma a sí mismo: dice que quien lo publica
 * tiene su clave privada, no que el servidor lo publicara ni que no exista otra
 * historia del directorio. Aquí se prueba lo que cierra ese hueco: la prueba de
 * inclusión lleva la línea del dispositivo hasta la raíz, la raíz la firma el
 * operador, y cualquier retoque —de la línea, de la rama o de la raíz— se nota.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import "./olm-setup.ts";

import * as v2 from "../src/lib/e2e-v2.ts";
import {
  snapshotMessage,
  verifyDeviceProof,
  verifyInclusion,
  verifySnapshotSignature,
  type KeySnapshotHeader,
} from "../src/lib/e2e-v2-directory.ts";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let db: DbModule;
let transparency: typeof import("../src/lib/transparency.ts");

before(async () => {
  repo = await import("../src/lib/repo.ts");
  db = await import("../src/lib/db/index.ts");
  transparency = await import("../src/lib/transparency.ts");
});

function cuenta(nombre: string): string {
  return repo.createUser({
    name: nombre,
    email: `${nombre.toLowerCase().replaceAll(" ", ".")}@example.org`,
    passwordHash: "scrypt$1,1,1$sal$hash",
    city: "Stuttgart",
  }).id;
}

/** Clave de firma del operador, como la que usa el cron. */
function claveDeFirma() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const base64 = Buffer.from(privateKey.export({ format: "der", type: "pkcs8" })).toString("base64");
  return transparency.signingKey(base64)!;
}

/** La cabecera pública de una instantánea, como la sirve la ruta. */
function cabeceraDe(snapshot: {
  id: string;
  createdAt: string;
  itemCount: number;
  merkleRoot: string;
  previousRoot: string | null;
  signature: string | null;
  publicKey: string | null;
}): KeySnapshotHeader {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    itemCount: snapshot.itemCount,
    merkleRoot: snapshot.merkleRoot,
    previousRoot: snapshot.previousRoot,
    signature: snapshot.signature,
    publicKey: snapshot.publicKey,
  };
}

async function dispositivoPublicado(userId: string, deviceId = "dispositivo-directorio-1") {
  const account = await v2.createAccount(2);
  const signed = v2.deviceKeys(account, deviceId);
  await repo.publishDevice(userId, { ...signed, oneTimeKeys: v2.oneTimeKeys(account, deviceId) });
  return { deviceId, identityKey: signed.identityKey, signingKey: signed.signingKey };
}

test("la prueba de un dispositivo verifica contra la raíz firmada", async () => {
  const ana = cuenta("Ana Directorio");
  const { deviceId, identityKey, signingKey } = await dispositivoPublicado(ana);
  const snapshot = transparency.createKeySnapshot(db.getDb(), {
    key: claveDeFirma(),
    now: "2027-02-01T00:00:00.000Z",
  });

  const proof = transparency.keyInclusion(ana, `device:${deviceId}`)!;
  assert.ok(proof, "el dispositivo está en el directorio");

  const resultado = await verifyDeviceProof(
    { line: proof.line, index: proof.index, branch: proof.branch, root: proof.root },
    {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      itemCount: snapshot.itemCount,
      merkleRoot: snapshot.merkleRoot,
      previousRoot: snapshot.previousRoot,
      signature: snapshot.signature,
      publicKey: snapshot.publicKey,
    },
    { userId: ana, deviceId, identityKey, signingKey },
  );
  assert.equal(resultado.ok, true, resultado.reason);
});

test("una línea, una rama o una raíz retocadas no cuadran", async () => {
  const bruno = cuenta("Bruno Directorio");
  const { deviceId, identityKey, signingKey } = await dispositivoPublicado(bruno);
  const snapshot = transparency.createKeySnapshot(db.getDb(), {
    key: claveDeFirma(),
    now: "2027-03-01T00:00:00.000Z",
  });
  const proof = transparency.keyInclusion(bruno, `device:${deviceId}`)!;
  const cabecera: KeySnapshotHeader = {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    itemCount: snapshot.itemCount,
    merkleRoot: snapshot.merkleRoot,
    previousRoot: snapshot.previousRoot,
    signature: snapshot.signature,
    publicKey: snapshot.publicKey,
  };

  const esperado = { userId: bruno, deviceId, identityKey, signingKey };
  const lineaCambiada = { line: proof.line.replace(identityKey, "Z".repeat(43)), index: proof.index, branch: proof.branch, root: proof.root };
  assert.equal(await verifyInclusion(lineaCambiada), false, "otra clave no llega a la misma raíz");
  assert.equal((await verifyDeviceProof(lineaCambiada, cabecera, esperado)).ok, false);

  const raizCambiada = { ...cabecera, merkleRoot: "f".repeat(64) };
  assert.equal(
    (await verifyDeviceProof({ line: proof.line, index: proof.index, branch: proof.branch, root: "f".repeat(64) }, raizCambiada, esperado)).ok,
    false,
  );

  // La prueba de otro dispositivo no vale para este.
  assert.equal(
    (await verifyDeviceProof(
      { line: proof.line, index: proof.index, branch: proof.branch, root: proof.root },
      cabecera,
      { ...esperado, identityKey: "Y".repeat(43) },
    )).ok,
    false,
  );
});

test("una prueba válida de otra cuenta no sirve aunque traiga la misma clave", async () => {
  // El `deviceId` lo elige el cliente y es público: una cuenta hostil puede
  // publicar un dispositivo con el mismo id y su propia clave. Si la
  // comprobación solo buscara la clave dentro de la línea, esa prueba —firmada,
  // incluida y con la clave que el servidor acaba de enseñar— pasaría y el
  // mensaje saldría cifrado para quien no es el destinatario.
  const victima = cuenta("Ana Suplantada");
  const atacante = cuenta("Mallory Suplantador");
  const deviceId = "dispositivo-compartido";
  await dispositivoPublicado(victima, deviceId);
  const suyo = await dispositivoPublicado(atacante, deviceId);

  const snapshot = transparency.createKeySnapshot(db.getDb(), {
    key: claveDeFirma(),
    now: "2027-05-01T00:00:00.000Z",
  });
  const proof = transparency.keyInclusion(atacante, `device:${deviceId}`)!;
  const cabecera: KeySnapshotHeader = {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    itemCount: snapshot.itemCount,
    merkleRoot: snapshot.merkleRoot,
    previousRoot: snapshot.previousRoot,
    signature: snapshot.signature,
    publicKey: snapshot.publicKey,
  };
  const comoSiFueraDeLaVictima = {
    line: proof.line,
    index: proof.index,
    branch: proof.branch,
    root: proof.root,
  };

  // La prueba es criptográficamente buena para la cuenta del atacante…
  assert.equal(
    (await verifyDeviceProof(comoSiFueraDeLaVictima, cabecera, {
      userId: atacante,
      deviceId,
      identityKey: suyo.identityKey,
      signingKey: suyo.signingKey,
    })).ok,
    true,
  );
  // …y no vale para la cuenta a la que el servidor dice que pertenece.
  const suplantada = await verifyDeviceProof(comoSiFueraDeLaVictima, cabecera, {
    userId: victima,
    deviceId,
    identityKey: suyo.identityKey,
    signingKey: suyo.signingKey,
  });
  assert.equal(suplantada.ok, false);
  assert.match(suplantada.reason ?? "", /otra cuenta/);
});

test("una prueba mal formada se rechaza sin calcular hashes", async () => {
  const dani = cuenta("Dani Directorio");
  const { deviceId, identityKey, signingKey } = await dispositivoPublicado(dani, "dispositivo-malformado");
  const snapshot = transparency.createKeySnapshot(db.getDb(), {
    key: claveDeFirma(),
    now: "2027-06-01T00:00:00.000Z",
  });
  const proof = transparency.keyInclusion(dani, `device:${deviceId}`)!;
  const base = { line: proof.line, index: proof.index, branch: proof.branch, root: proof.root };
  const esperado = { userId: dani, deviceId, identityKey, signingKey };
  const cabecera: KeySnapshotHeader = {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    itemCount: snapshot.itemCount,
    merkleRoot: snapshot.merkleRoot,
    previousRoot: snapshot.previousRoot,
    signature: snapshot.signature,
    publicKey: snapshot.publicKey,
  };

  assert.equal(await verifyInclusion({ ...base, index: -1 }), false);
  assert.equal(await verifyInclusion({ ...base, index: 1.5 }), false);
  assert.equal(
    await verifyInclusion({ ...base, branch: [{ hash: proof.branch[0]?.hash ?? "a".repeat(64), side: "lado" as never }] }),
    false,
    "un lado que no es left ni right no se interpreta",
  );
  assert.equal(
    await verifyInclusion({ ...base, branch: [{ hash: "no-es-un-hash", side: "left" }] }),
    false,
  );
  assert.equal(
    await verifyDeviceProof({ ...base, index: snapshot.itemCount }, cabecera, esperado).then(
      (result) => result.ok,
    ),
    false,
    "un índice fuera del árbol no vale",
  );
  assert.equal((await verifyDeviceProof(base, cabecera, esperado)).ok, true);
});

test("la prueba de un dispositivo retirado no se acepta como si estuviera activo", async () => {
  // El aparato sigue en el árbol —el directorio es un histórico—, así que la
  // inclusión verifica; lo que dice que ya no vale es el estado de la línea.
  const elena = cuenta("Elena Retirada");
  const deviceId = "dispositivo-retirado-1";
  const { identityKey, signingKey } = await dispositivoPublicado(elena, deviceId);

  const alPublicar = transparency.createKeySnapshot(db.getDb(), {
    key: claveDeFirma(),
    now: "2027-07-01T00:00:00.000Z",
  });
  assert.equal(
    (await verifyDeviceProof(
      (() => {
        const proof = transparency.keyInclusion(elena, `device:${deviceId}`)!;
        return { line: proof.line, index: proof.index, branch: proof.branch, root: proof.root };
      })(),
      cabeceraDe(alPublicar),
      { userId: elena, deviceId, identityKey, signingKey },
    )).ok,
    true,
    "recién publicado, vale",
  );

  repo.revokeDevice(elena, deviceId);
  const trasRetirar = transparency.createKeySnapshot(db.getDb(), {
    key: claveDeFirma(),
    now: "2027-07-02T00:00:00.000Z",
  });
  const prueba = transparency.keyInclusion(elena, `device:${deviceId}`)!;
  assert.match(prueba.line, /\|revoked:\d{4}-/, "la línea lleva la fecha de retirada");

  const tras = await verifyDeviceProof(
    { line: prueba.line, index: prueba.index, branch: prueba.branch, root: prueba.root },
    cabeceraDe(trasRetirar),
    { userId: elena, deviceId, identityKey, signingKey },
  );
  assert.equal(tras.ok, false);
  assert.match(tras.reason ?? "", /retirado/);
});

test("una instantánea sin firma o con otra clave no verifica", async () => {
  const carla = cuenta("Carla Directorio");
  await dispositivoPublicado(carla);
  const clave = claveDeFirma();
  const snapshot = transparency.createKeySnapshot(db.getDb(), {
    key: clave,
    now: "2027-04-01T00:00:00.000Z",
  });
  const cabecera: KeySnapshotHeader = {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    itemCount: snapshot.itemCount,
    merkleRoot: snapshot.merkleRoot,
    previousRoot: snapshot.previousRoot,
    signature: snapshot.signature,
    publicKey: snapshot.publicKey,
  };

  assert.equal(await verifySnapshotSignature(cabecera), true);
  assert.equal(await verifySnapshotSignature({ ...cabecera, signature: null }), false);

  // Firmada por otra clave: la comprobación falla aunque el formato sea válido.
  const otra = claveDeFirma();
  assert.equal(await verifySnapshotSignature({ ...cabecera, publicKey: otra.publicKey }), false);

  // Y el mensaje firmado es exactamente el que compone el servidor.
  assert.equal(
    snapshotMessage(cabecera),
    [snapshotMessage(cabecera).split("\n")[0], snapshot.id, snapshot.createdAt, String(snapshot.itemCount), snapshot.merkleRoot, snapshot.previousRoot ?? ""].join("\n"),
  );
});
