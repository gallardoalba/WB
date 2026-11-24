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
import { verifyConsistencyProof } from "../src/lib/e2e-v2-directory.ts";

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
  // La lista que sirve `/api/transparency/keys` empieza por la misma: si no, el
  // histórico mostraría como última una instantánea distinta de la que sostiene
  // las pruebas de inclusión.
  assert.deepEqual(
    transparency.listKeySnapshots(2, getDb()).map((snapshot) => snapshot.id),
    [despues.id, antes.id],
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

  // La más reciente del fichero: `keyInclusion` busca en la última instantánea,
  // y los casos anteriores ya fijan marcas en el futuro.
  const snapshot = transparency.createKeySnapshot(getDb(), {
    key: keyPair(),
    now: "2100-01-01T00:00:00.000Z",
  });
  const proof = transparency.keyInclusion(id, `device:${deviceId}`)!;
  assert.equal(proof.snapshotId, snapshot.id);
  assert.equal(
    transparency.verifyMerkleBranch(proof.line, proof.index, proof.branch, proof.root),
    true,
    "y con prueba de inclusión contra la raíz firmada",
  );
});

test("publicar un dispositivo deja prueba de inclusión ese mismo día", async () => {
  // Las instantáneas se crean una vez al día: sin refrescarla al dar de alta un
  // dispositivo, este se quedaba sin prueba hasta el día siguiente y, con las
  // dos partes en v2, el servidor rechazaba los mensajes en v1.
  getDb().prepare("DELETE FROM key_snapshots").run();
  const v2 = await import("../src/lib/e2e-v2.ts");
  const id = cuenta("Fátima Alta");
  const account = await v2.createAccount(2);
  const deviceId = "fatima-dispositivo-01";
  const signed = v2.deviceKeys(account, deviceId);
  await repo.publishDevice(id, { ...signed, oneTimeKeys: v2.oneTimeKeys(account, deviceId) });

  assert.equal(
    transparency.keyInclusion(id, `device:${deviceId}`),
    null,
    "recién publicado, todavía no hay instantánea que lo incluya",
  );
  transparency.ensureKeySnapshotForDevice(id, deviceId);
  assert.ok(
    transparency.keyInclusion(id, `device:${deviceId}`),
    "y tras asegurarla, la prueba existe",
  );
});

test("la prueba de consistencia une dos instantáneas del registro", async () => {
  // Se genera en el servidor y se verifica con el verificador del **cliente**:
  // son dos implementaciones distintas y tienen que coincidir. Y se prueban todas
  // las parejas, que es donde estos algoritmos se rompen (potencias de dos,
  // tamaños impares y el árbol de una sola hoja).
  const lineas: string[] = [];
  for (let index = 0; index < 9; index += 1) {
    lineas.push(`cuenta-${index}|web|clave-${index}|2026-01-0${index + 1}`);
  }

  for (let grande = 1; grande <= lineas.length; grande += 1) {
    for (let pequena = 1; pequena <= grande; pequena += 1) {
      const prueba = transparency.merkleConsistencyProof(
        lineas.slice(0, pequena),
        lineas.slice(0, grande),
      );
      assert.ok(prueba, `${pequena}→${grande}: debería existir`);
      assert.equal(
        await verifyConsistencyProof(
          pequena,
          transparency.merkleRoot(lineas.slice(0, pequena)),
          grande,
          transparency.merkleRoot(lineas.slice(0, grande)),
          prueba,
        ),
        true,
        `${pequena}→${grande}: la prueba no cuadra`,
      );
    }
  }
});

test("si el árbol nuevo no empieza por el viejo, no hay prueba que dar", async () => {
  const lineas = ["a", "b", "c", "d"];
  const otro = ["a", "b", "X", "d"];
  assert.equal(transparency.merkleConsistencyProof(lineas.slice(0, 3), otro), null);

  // Y una prueba de la historia buena no vale para la otra raíz.
  const prueba = transparency.merkleConsistencyProof(lineas.slice(0, 2), lineas)!;
  assert.equal(
    await verifyConsistencyProof(
      2,
      transparency.merkleRoot(lineas.slice(0, 2)),
      4,
      transparency.merkleRoot(otro),
      prueba,
    ),
    false,
  );
});

test("el registro solo crece: cada instantánea continúa la anterior", async () => {
  // Es lo que hace posible la prueba de consistencia. Antes la lista se
  // reconstruía desde el estado actual y una rotación cambiaba una hoja en su
  // sitio: el árbol nuevo no era una extensión del viejo.
  const id = cuenta("Irene Registro");
  repo.setPublicKey(id, jwk("irene"), "initial");
  const antes = transparency.createKeySnapshot(getDb(), {
    key: keyPair(),
    now: "2101-01-01T00:00:00.000Z",
  });

  repo.setPublicKey(id, jwk("irene-rotada"), "rotation");
  const despues = transparency.createKeySnapshot(getDb(), {
    key: keyPair(),
    now: "2101-01-02T00:00:00.000Z",
  });

  assert.ok(
    despues.itemCount > antes.itemCount,
    "rotar añade una línea, no reescribe la de antes",
  );
  const lineas = transparency.keyDirectoryLines(getDb());
  assert.equal(
    lineas.filter((line) => line.startsWith(`${id}|web|`)).length,
    2,
    "quedan las dos: el histórico no se borra",
  );
  assert.ok(
    transparency.keyInclusion(id)!.line.includes(repo.getPublicKeyRecord(id)!.keyId),
    "y la prueba devuelve la última, que es la que vale",
  );

  const prueba = transparency.consistencyProofBetween(antes.id, despues.id)!;
  assert.ok(prueba, "hay prueba entre las dos instantáneas");
  assert.equal(
    await verifyConsistencyProof(
      antes.itemCount,
      antes.merkleRoot,
      despues.itemCount,
      despues.merkleRoot,
      prueba.proof,
    ),
    true,
  );
});

test("reponer claves de un solo uso no engorda el directorio", async () => {
  const v2 = await import("../src/lib/e2e-v2.ts");
  const id = cuenta("Julia Repone");
  const account = await v2.createAccount(2);
  const deviceId = "julia-dispositivo-01";
  await repo.publishDevice(id, {
    ...v2.deviceKeys(account, deviceId),
    oneTimeKeys: v2.oneTimeKeys(account, deviceId),
  });
  const trasAlta = transparency.keyDirectoryLines(getDb()).length;

  // Segundo anuncio del mismo aparato (misma identidad): solo repone claves.
  await repo.publishDevice(id, {
    ...v2.deviceKeys(account, deviceId),
    oneTimeKeys: v2.oneTimeKeys(account, deviceId),
  });
  assert.equal(
    transparency.keyDirectoryLines(getDb()).length,
    trasAlta,
    "no hay nada nuevo que contar en el directorio",
  );

  repo.revokeDevice(id, deviceId);
  assert.equal(
    transparency.keyDirectoryLines(getDb()).length,
    trasAlta + 1,
    "retirarlo sí: deja una línea nueva con el estado",
  );
});
