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

/** La entrada más reciente de un registro, por fecha (y sin fiarse del orden). */
export function newestEntry(entries: WitnessEntry[], log: WitnessLog): WitnessEntry | null {
  let newest: WitnessEntry | null = null;
  for (const entry of entries) {
    if (entry.log !== log) continue;
    if (!newest || entry.createdAt > newest.createdAt) newest = entry;
  }
  return newest;
}

/**
 * Compara lo apuntado con lo publicado ahora.
 *
 * Se compara **lo que la API sigue publicando** contra lo que el testigo apuntó:
 * la API sirve las últimas veinte instantáneas, así que exigir que estén todas
 * las apuntadas convertía el testigo en un fallo permanente en cuanto pasaba un
 * mes (y el fallo era del testigo, no del servidor). Borrar una instantánea
 * dentro de la ventana se nota igual, porque la cadena de `previousRoot` deja de
 * enlazar (`auditPublished`).
 *
 * Lo que sí se exige es que lo publicado no se quede atrás: si la instantánea
 * más reciente que sirve el servidor es anterior a la última que el testigo vio,
 * ha vuelto a una historia vieja.
 */
export function compareWithWitness(seen: WitnessEntry[], published: WitnessEntry[]): string[] {
  const problems: string[] = [];
  const porClave = new Map(seen.map((entry) => [clave(entry), entry]));

  for (const ahora of published) {
    const antes = porClave.get(clave(ahora));
    if (!antes) continue;
    if (ahora.merkleRoot !== antes.merkleRoot) {
      problems.push(
        `${clave(ahora)} cambió de raíz: el testigo apuntó ${antes.merkleRoot} y ahora publica ${ahora.merkleRoot}`,
      );
    }
    if (ahora.signature !== antes.signature) {
      problems.push(`${clave(ahora)} cambió de firma`);
    }
    if (ahora.publicKey !== antes.publicKey) {
      problems.push(`${clave(ahora)} cambió de clave pública`);
    }
  }

  for (const log of ["catalogue", "keys"] as const) {
    const apuntado = newestEntry(seen, log);
    const publicado = newestEntry(published, log);
    if (!apuntado || !publicado || publicado.id === apuntado.id) continue;
    if (publicado.createdAt < apuntado.createdAt) {
      problems.push(
        `${log}: lo publicado (${publicado.id}) es anterior a lo último que el testigo vio (${apuntado.id})`,
      );
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
