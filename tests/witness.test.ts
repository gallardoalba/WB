/**
 * El testigo: guardar lo que se vio para poder pillar una historia reescrita.
 *
 * La firma la pone el propio operador, así que dos historias distintas pueden
 * estar las dos bien firmadas. Aquí se comprueba lo único que lo detecta: que una
 * raíz apuntada no cambie, que no desaparezcan instantáneas y que una firma rota
 * o una cadena partida no se acepten como testables.
 */
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";

import { snapshotMessage } from "../src/lib/transparency.ts";
import * as witness from "../src/lib/witness.ts";

const claveDePrueba = () => generateKeyPairSync("ed25519").privateKey;

test("un testigo acepta raíces nuevas pero no una ya vista que cambia", () => {
  const antes = {
    log: "catalogue" as const,
    id: "snp_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    merkleRoot: "raiz-original",
    previousRoot: null,
    itemCount: 3,
    signature: "firma-1",
    publicKey: "clave-1",
    seenAt: "2026-01-01T00:05:00.000Z",
  };
  const nueva = {
    ...antes,
    id: "snp_2",
    createdAt: "2026-01-02T00:00:00.000Z",
    merkleRoot: "raiz-nueva",
    previousRoot: "raiz-original",
    signature: "firma-2",
  };

  assert.deepEqual(witness.compareWithWitness([antes], [antes, nueva]), []);
  assert.equal(witness.freshEntries([antes], [antes, nueva]).length, 1);

  // La misma instantánea con otra raíz: alguien contó dos historias.
  const reescrita = { ...antes, merkleRoot: "raiz-reescrita" };
  const problemas = witness.compareWithWitness([antes], [reescrita]);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!, /cambió de raíz/);

  // Y borrar una instantánea apuntada también se nota.
  assert.match(
    witness.compareWithWitness([antes], [])[0]!,
    /ya no se publica/,
  );
});

test("el fichero del testigo va y vuelve sin perder nada", () => {
  const entrada = {
    log: "keys" as const,
    id: "key_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    merkleRoot: "raiz",
    previousRoot: null,
    itemCount: 1,
    signature: "firma",
    publicKey: "clave",
    seenAt: "2026-01-01T00:05:00.000Z",
  };
  assert.deepEqual(witness.parseWitness(witness.formatWitness([entrada])), [entrada]);
});

test("una instantánea sin firma no se puede atestiguar", () => {
  const snapshot = {
    id: "snp_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    itemCount: 1,
    merkleRoot: "raiz",
    payloadHash: "hash",
    previousRoot: null,
    signature: null,
    publicKey: null,
    signer: null,
  };
  const audit = witness.auditPublished({ catalogue: [snapshot], keys: [] });
  assert.equal(audit.ok, false);
  assert.match(audit.problems.join(" "), /sin firma/);
});

test("una firma que no valida deja la atestación en nada", () => {
  const privada = claveDePrueba();
  const publica = createPublicKey(privada).export({ format: "der", type: "spki" }) as Buffer;

  const base = {
    id: "snp_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    itemCount: 1,
    merkleRoot: "raiz",
    payloadHash: "hash",
    previousRoot: null,
    publicKey: publica.toString("base64"),
    signer: "test",
  };
  const firmada = (texto: string) => sign(null, Buffer.from(texto), privada).toString("base64");

  // La misma cadena que firma `createSnapshot`.
  const bueno = firmada(snapshotMessage(base));
  const valida = witness.auditPublished({
    catalogue: [{ ...base, signature: bueno }],
    keys: [],
  });
  assert.deepEqual(valida.problems, []);
  assert.equal(valida.ok, true);

  const rota = witness.auditPublished({
    catalogue: [{ ...base, signature: firmada("otra cosa") }],
    keys: [],
  });
  assert.equal(rota.ok, false);
  assert.match(rota.problems.join(" "), /firma inválida/);
});
