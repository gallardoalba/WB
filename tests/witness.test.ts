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

  // Que la ventana de la API haya dejado atrás una instantánea vieja no es un
  // problema: es el paso del tiempo. Antes se denunciaba, y el testigo entraba
  // en fallo permanente en cuanto había más de veinte.
  assert.deepEqual(witness.compareWithWitness([antes], [nueva]), []);

  // Lo que sí es un problema es que lo publicado se quede atrás.
  const atras = witness.compareWithWitness([nueva], [antes]);
  assert.equal(atras.length, 1);
  assert.match(atras[0]!, /anterior a lo último que el testigo vio/);
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

test("una ventana de veinte no es un fallo aunque haya mucho apuntado", () => {
  // La API sirve las últimas veinte instantáneas. Exigir que estuvieran todas
  // las apuntadas convertía el testigo en un fallo permanente en cuanto pasaba
  // un mes, y el fallo habría sido del testigo, no del servidor.
  const apuntadas = Array.from({ length: 40 }, (_, index) => ({
    log: "keys" as const,
    id: `kys_${String(index).padStart(4, "0")}`,
    createdAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    merkleRoot: `raiz-${index}`,
    previousRoot: index === 0 ? null : `raiz-${index - 1}`,
    itemCount: index + 1,
    signature: `firma-${index}`,
    publicKey: "clave",
    seenAt: `2026-02-01T00:00:0${index % 10}.000Z`,
  }));
  const ventana = apuntadas.slice(-20).reverse();

  assert.deepEqual(witness.compareWithWitness(apuntadas, ventana), []);

  // Pero si lo publicado se queda atrás, se dice.
  const atras = witness.compareWithWitness(apuntadas, ventana.slice(5));
  assert.equal(atras.length, 1);
  assert.match(atras[0]!, /anterior a lo último que el testigo vio/);
});

test("un registro que deja de publicar instantáneas se denuncia", () => {
  const antes = {
    log: "keys" as const,
    id: "kys_00000000-0000-4000-8000-000000000001",
    createdAt: "2026-01-01T00:00:00.000Z",
    merkleRoot: "raiz",
    previousRoot: null,
    itemCount: 1,
    signature: "firma",
    publicKey: "clave",
    seenAt: "2026-01-01T00:05:00.000Z",
  };
  const problemas = witness.compareWithWitness([antes], []);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0]!, /ya no publica ninguna instantánea/);
});

test("un cambio de la clave del operador se denuncia aunque el id sea nuevo", () => {
  const antes = {
    log: "keys" as const,
    id: "kys_00000000-0000-4000-8000-000000000001",
    createdAt: "2026-01-01T00:00:00.000Z",
    merkleRoot: "raiz-1",
    previousRoot: null,
    itemCount: 1,
    signature: "firma-1",
    publicKey: "clave-1",
    seenAt: "2026-01-01T00:05:00.000Z",
  };
  const nueva = {
    ...antes,
    id: "kys_00000000-0000-4000-8000-000000000002",
    createdAt: "2026-01-02T00:00:00.000Z",
    merkleRoot: "raiz-2",
    previousRoot: "raiz-1",
    signature: "firma-2",
    publicKey: "clave-2",
  };
  const problemas = witness.compareWithWitness([antes], [antes, nueva]);
  assert.ok(problemas.some((problem) => /clave pública del operador/.test(problem)));
});
