import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import type { Db } from "../src/lib/db/index.ts";
import {
  catalogLines,
  createSnapshot,
  ensureDailySnapshot,
  latestSnapshot,
  listSnapshots,
  merkleRoot,
  payloadHash,
  payloadOf,
  prunePayloads,
  readPayload,
  signingKey,
  stableJson,
  verifyChain,
  verifySnapshot,
  type TransparencySnapshot,
} from "../src/lib/transparency.ts";

/**
 * Instantáneas firmadas del catálogo público.
 *
 * Lo que se fija aquí es el contrato que un verificador externo va a repetir:
 * serialización canónica, raíz de Merkle, mensaje firmado y detección de
 * manipulación. Si cambia cualquiera de esos pasos, la comprobación deja de
 * significar lo mismo y estos casos lo dicen antes de publicar nada.
 */

const ed25519Pem = () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ format: "pem", type: "pkcs8" }).toString();
};

let db: Db;

// La base se abre en el primer uso, así que basta con fijar la ruta arriba.
before(async () => {
  const database = await import("../src/lib/db/index.ts");
  db = database.getDb();
});

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");

const lines = ["a", "b", "c"].map((name) => stableJson({ id: name, copies: 1 }));

test("la serialización canónica ordena claves y descarta lo indefinido", () => {
  assert.equal(stableJson({ b: 1, a: [2, { d: 4, c: 3 }] }), '{"a":[2,{"c":3,"d":4}],"b":1}');
  assert.equal(stableJson({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(stableJson(null), "null");
  assert.equal(stableJson("texto"), '"texto"');
});

test("la raíz de Merkle sigue la regla que repetirá el verificador", () => {
  const leaf = (line: string) => sha256(`leaf:${line}`);
  const node = (left: string, right: string) => sha256(`node:${left}${right}`);

  assert.equal(merkleRoot([]), sha256(""));
  assert.equal(merkleRoot(["uno"]), leaf("uno"));
  // Nodo impar promovido tal cual al siguiente nivel.
  assert.equal(merkleRoot(["a", "b", "c"]), node(node(leaf("a"), leaf("b")), leaf("c")));
  // El orden importa: es lo que ata la raíz al contenido, no a un conjunto.
  assert.notEqual(merkleRoot(["a", "b"]), merkleRoot(["b", "a"]));
});

test("el NDJSON acaba en salto de línea y una instantánea vacía pesa cero", () => {
  assert.equal(payloadOf(["a", "b"]), "a\nb\n");
  assert.equal(payloadOf([]), "");
  assert.equal(payloadHash(""), sha256(""));
});

test("solo se acepta una clave Ed25519; el resto no firma", () => {
  const pem = ed25519Pem();
  const fromPem = signingKey(pem);
  assert.ok(fromPem);
  assert.equal(signingKey("") ? true : false, false);
  assert.equal(signingKey("no-es-base64"), null);
  // Una clave RSA no sirve para este esquema.
  const { privateKey: rsa } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.equal(signingKey(rsa.export({ format: "pem", type: "pkcs8" }).toString()), null);
});

test("una instantánea firmada se guarda, se descarga y se verifica", () => {
  const key = signingKey(ed25519Pem())!;
  const snapshot = createSnapshot(db, {
    now: "2026-11-10T00:00:00.000Z",
    key,
    lines,
  });

  assert.equal(snapshot.itemCount, 3);
  assert.equal(snapshot.previousRoot, null);
  assert.equal(snapshot.signature ? true : false, true);
  assert.equal(snapshot.publicKey, key.publicKey);

  const stored = readPayload(snapshot.id, db);
  assert.ok(stored);
  assert.equal(stored.payload, payloadOf(lines));
  assert.deepEqual(verifySnapshot(snapshot, stored.payload), { ok: true, problems: [] });

  // Los campos públicos llegan a la API sin el contenido.
  assert.deepEqual(listSnapshots(5, db)[0], snapshot);
});

test("una instantánea sin clave se publica, pero se declara sin prueba criptográfica", () => {
  const snapshot = createSnapshot(db, {
    now: "2026-11-09T00:00:00.000Z",
    key: null,
    lines,
  });
  const stored = readPayload(snapshot.id, db);

  assert.equal(snapshot.signature, null);
  const result = verifySnapshot(snapshot, stored!.payload);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, ["la instantánea no está firmada: esta instancia no publica una prueba criptográfica"]);
});

test("cualquier cambio en el contenido, la firma o la raíz se detecta", () => {
  const key = signingKey(ed25519Pem())!;
  const snapshot = createSnapshot(db, { now: "2026-11-08T00:00:00.000Z", key, lines });

  const tampered = payloadOf([...lines, stableJson({ id: "extra" })]);
  const byContent = verifySnapshot(snapshot, tampered);
  assert.equal(byContent.ok, false);
  assert.ok(byContent.problems.some((problem) => problem.includes("hash del contenido")));

  const forged: TransparencySnapshot = { ...snapshot, merkleRoot: merkleRoot([...lines, "x"]) };
  const byRoot = verifySnapshot(forged, payloadOf(lines));
  assert.ok(byRoot.problems.includes("la raíz de Merkle no coincide con el contenido"));

  const otherKey = signingKey(ed25519Pem())!;
  const bySignature = verifySnapshot(
    { ...snapshot, publicKey: otherKey.publicKey },
    payloadOf(lines),
  );
  assert.equal(bySignature.ok, false);
  assert.ok(bySignature.problems.some((problem) => problem.includes("firma Ed25519")));

  const badKey = verifySnapshot(
    { ...snapshot, publicKey: "esto-no-es-una-clave", signature: "AAAA" },
    payloadOf(lines),
  );
  assert.equal(badKey.ok, false);
  assert.ok(badKey.problems.some((problem) => problem.includes("firma Ed25519")));

  const pruned = verifySnapshot(snapshot, null);
  assert.deepEqual(pruned.problems, ["la instantánea ya no conserva el contenido descargable"]);
});

test("una instantánea al día: el cron no vuelve a firmar el mismo catálogo", () => {
  const key = signingKey(ed25519Pem())!;
  const first = ensureDailySnapshot(db, { now: "2026-11-12T08:00:00.000Z", key, lines });
  assert.ok(first);

  const second = ensureDailySnapshot(db, { now: "2026-11-12T20:00:00.000Z", key, lines });
  assert.equal(second, null);

  const next = ensureDailySnapshot(db, { now: "2026-11-13T00:00:00.000Z", key, lines });
  assert.ok(next);
  assert.equal(next.previousRoot, first.merkleRoot);
  assert.equal(latestSnapshot(db)?.id, next.id);
});

test("la cadena de raíces enlaza una instantánea con la anterior", () => {
  const key = signingKey(ed25519Pem())!;
  const older = createSnapshot(db, { now: "2026-11-06T00:00:00.000Z", key, lines });
  const newer = createSnapshot(db, { now: "2026-11-07T00:00:00.000Z", key, lines: [...lines, "x"] });

  assert.deepEqual(verifyChain([newer, older]), { ok: true, problems: [] });
  const broken = verifyChain([{ ...newer, previousRoot: "0".repeat(64) }, older]);
  assert.equal(broken.ok, false);
  assert.equal(broken.problems.length, 1);
});

test("el contenido antiguo se poda y la fila firmada se conserva", () => {
  const key = signingKey(ed25519Pem())!;
  const old = createSnapshot(db, { now: "2024-01-01T00:00:00.000Z", key, lines });
  // La siguiente instantánea dispara la poda de lo que ya pasó la retención.
  createSnapshot(db, { now: "2026-11-11T00:00:00.000Z", key, lines });

  assert.equal(readPayload(old.id, db)?.payload, null);
  assert.ok(listSnapshots(200, db).some((snapshot) => snapshot.id === old.id));

  const changed = prunePayloads(db, "2026-11-11T00:00:00.000Z", 1);
  assert.equal(typeof changed, "number");
});

test("un identificador desconocido no devuelve contenido", () => {
  assert.equal(readPayload("snp_no_existe", db), null);
});

test("el catálogo público va ordenado y no lleva datos de personas", () => {
  const first = catalogLines();
  assert.deepEqual(first, [...first].sort());
  for (const line of first) {
    const item = JSON.parse(line) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(item).sort(),
      [
        "author",
        "category",
        "cities",
        "copies",
        "id",
        "isbn",
        "language",
        "pages",
        "publisher",
        "series",
        "title",
        "year",
      ],
      "una línea nueva tendría que ser un campo público a propósito",
    );
    assert.ok(!line.includes("@"), "el catálogo público no publica correos");
  }
});
