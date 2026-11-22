/**
 * Testigo: apuntar las raíces que se vieron, para poder compararlas después.
 *
 * Una firma hecha por el operador no prueba que el operador enseñe lo mismo a
 * todo el mundo: puede firmar dos historias distintas y las dos son válidas. Lo
 * único que lo delata es alguien de fuera que guarde lo que vio y lo vuelva a
 * mirar. Estas funciones son esa memoria: recogen lo publicado, comprueban las
 * firmas y comparan con lo apuntado antes.
 */
import {
  verifyChain,
  verifyKeyChain,
  verifyKeySnapshotSignature,
  verifySignature,
  type KeySnapshot,
  type TransparencySnapshot,
} from "./transparency";

export type WitnessLog = "catalogue" | "keys";

/** Una raíz apuntada. Una línea del fichero del testigo. */
export type WitnessEntry = {
  log: WitnessLog;
  id: string;
  createdAt: string;
  merkleRoot: string;
  previousRoot: string | null;
  itemCount: number;
  signature: string | null;
  publicKey: string | null;
  /** Cuándo lo vio el testigo: sirve para probar desde cuándo sabía esto. */
  seenAt: string;
};

const clave = (entry: Pick<WitnessEntry, "log" | "id">) => `${entry.log}:${entry.id}`;

function entryOf(log: WitnessLog, snapshot: TransparencySnapshot | KeySnapshot, seenAt: string): WitnessEntry {
  return {
    log,
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    merkleRoot: snapshot.merkleRoot,
    previousRoot: snapshot.previousRoot,
    itemCount: snapshot.itemCount,
    signature: snapshot.signature,
    publicKey: snapshot.publicKey,
    seenAt,
  };
}

/**
 * Las firmas de lo publicado, ¿se sostienen?
 *
 * Se comprueba la firma de cada instantánea y que la cadena de raíces enlace.
 * Si la claves públicas que expone el servidor fueran sustituidas en bloque, la
 * firma seguiría validando; de ahí que el testigo apunte también la clave y el
 * fichero se guarde fuera (ver `docs/e2e-protocol-v2.md` §12).
 */
export function auditPublished(input: {
  catalogue: TransparencySnapshot[];
  keys: KeySnapshot[];
  seenAt?: string;
}): { ok: boolean; problems: string[]; entries: WitnessEntry[] } {
  const seenAt = input.seenAt ?? new Date().toISOString();
  const problems: string[] = [];

  const unsignedCatalogue = input.catalogue.filter((snapshot) => !snapshot.signature);
  if (unsignedCatalogue.length > 0) {
    problems.push(
      `${unsignedCatalogue.length} instantáneas del catálogo sin firma: no hay nada que atestiguar`,
    );
  }
  const unsignedKeys = input.keys.filter((snapshot) => !snapshot.signature);
  if (unsignedKeys.length > 0) {
    problems.push(`${unsignedKeys.length} instantáneas de claves sin firma`);
  }

  for (const snapshot of input.catalogue) {
    if (snapshot.signature && !verifySignature(snapshot)) problems.push(`firma inválida en ${snapshot.id}`);
  }
  for (const snapshot of input.keys) {
    if (snapshot.signature && !verifyKeySnapshotSignature(snapshot)) {
      problems.push(`firma inválida en las claves ${snapshot.id}`);
    }
  }

  const chain = verifyChain([...input.catalogue].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  const keyChain = verifyKeyChain([...input.keys].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  problems.push(...chain.problems, ...keyChain.problems);

  return {
    ok: problems.length === 0,
    problems,
    entries: [
      ...input.catalogue.map((snapshot) => entryOf("catalogue", snapshot, seenAt)),
      ...input.keys.map((snapshot) => entryOf("keys", snapshot, seenAt)),
    ],
  };
}

/**
 * Compara lo apuntado con lo publicado ahora.
 *
 * Tres formas de fallar: una raíz apuntada cambió (reescribió la historia), una
 * instantánea apuntada desapareció (borró lo que no le interesaba), o la cadena
 * enlaza mal. Una entrada nueva no es un problema: es el paso del tiempo.
 */
export function compareWithWitness(seen: WitnessEntry[], published: WitnessEntry[]): string[] {
  const problems: string[] = [];
  const porClave = new Map(published.map((entry) => [clave(entry), entry]));

  for (const antes of seen) {
    const ahora = porClave.get(clave(antes));
    if (!ahora) {
      problems.push(`la instantánea ${clave(antes)} ya no se publica`);
      continue;
    }
    if (ahora.merkleRoot !== antes.merkleRoot) {
      problems.push(
        `${clave(antes)} cambió de raíz: el testigo apuntó ${antes.merkleRoot} y ahora publica ${ahora.merkleRoot}`,
      );
    }
    if (ahora.signature !== antes.signature) {
      problems.push(`${clave(antes)} cambió de firma`);
    }
    if (ahora.publicKey !== antes.publicKey) {
      problems.push(`${clave(antes)} cambió de clave pública`);
    }
  }
  return problems;
}

/** Las que aún no estaban apuntadas. */
export function freshEntries(seen: WitnessEntry[], published: WitnessEntry[]): WitnessEntry[] {
  const yaEstaban = new Set(seen.map(clave));
  return published.filter((entry) => !yaEstaban.has(clave(entry)));
}

/** Fichero del testigo: una línea JSON por entrada. */
export function parseWitness(text: string): WitnessEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as WitnessEntry);
}

export function formatWitness(entries: WitnessEntry[]): string {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}
