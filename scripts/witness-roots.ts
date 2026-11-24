/**
 * Testigo externo: deja constancia de las raíces que ve y las compara después.
 *
 *   npm run transparency:witness -- --url https://… --file ../wb-witness/roots.jsonl
 *   npm run transparency:witness -- --check --file …   # solo verifica
 *
 * Modo normal comprueba firmas y cadenas, y **añade** las instantáneas nuevas al
 * fichero. Modo `--check` no escribe: falla si una raíz apuntada cambió, si una
 * instantánea desapareció o si la cadena se rompió.
 *
 * El valor del fichero está en guardarlo **fuera de la instancia vigilada**:
 * publicado en otro repositorio o en manos de otra persona. En el mismo servidor
 * que firma no demuestra nada, y el script lo recuerda al terminar.
 *
 * Solo necesita la URL pública; no toca la base ni el código del servidor.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { KeySnapshot, TransparencySnapshot } from "../src/lib/transparency";
import { verifyConsistencyProof } from "../src/lib/e2e-v2-directory";
import {
  auditPublished,
  compareWithWitness,
  formatWitness,
  freshEntries,
  parseWitness,
  type WitnessEntry,
} from "../src/lib/witness";

type Args = { url: string; file: string; check: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = {
    url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    file: process.env.TRANSPARENCY_WITNESS_FILE?.trim() || "witness/roots.jsonl",
    check: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") {
      args.check = true;
      continue;
    }
    const value = argv[index + 1];
    if ((flag === "--url" || flag === "--file") && value) {
      if (flag === "--url") args.url = value.replace(/\/+$/, "");
      if (flag === "--file") args.file = value;
      index += 1;
    }
  }
  return args;
}

/** Lo apuntado hasta ahora. Sin fichero todavía, no hay nada apuntado. */
function readSeen(file: string): WitnessEntry[] {
  try {
    return parseWitness(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
  return (await response.json()) as T;
}

/** La última instantánea del directorio que el testigo apuntó, con su raíz. */
function lastPinned(seen: WitnessEntry[]): WitnessEntry | null {
  return seen.filter((entry) => entry.log === "keys").at(-1) ?? null;
}

/**
 * Pide la prueba de consistencia entre lo apuntado y lo último publicado.
 *
 * Devuelve el problema, o `null` si cuadra o si no hay nada que comprobar (la
 * primera vez, o cuando la raíz no ha cambiado).
 */
async function checkConsistency(
  url: string,
  seen: WitnessEntry[],
  published: WitnessEntry[],
): Promise<string | null> {
  const from = lastPinned(seen);
  const current = published.filter((entry) => entry.log === "keys").at(-1);
  if (!from || !current) return null;
  if (from.id === current.id || from.merkleRoot === current.merkleRoot) return null;

  const answer = await getJson<{
    from: { id: string; itemCount: number; merkleRoot: string };
    to: { id: string; itemCount: number; merkleRoot: string };
    proof: string[];
  }>(
    `${url}/api/transparency/keys/consistency?from=${encodeURIComponent(from.id)}&to=${encodeURIComponent(current.id)}`,
  );
  if (answer.from.itemCount !== from.itemCount || answer.from.merkleRoot !== from.merkleRoot) {
    return "la prueba de consistencia no parte de la instantánea que el testigo apuntó";
  }
  if (answer.to.itemCount !== current.itemCount || answer.to.merkleRoot !== current.merkleRoot) {
    return "la prueba de consistencia no termina en la instantánea publicada";
  }
  const ok = await verifyConsistencyProof(
    from.itemCount,
    from.merkleRoot,
    current.itemCount,
    current.merkleRoot,
    answer.proof,
  );
  return ok ? null : `${current.id} no continúa la instantánea apuntada ${from.id}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const catalogo = await getJson<{ snapshots: TransparencySnapshot[] }>(`${args.url}/api/transparency`);
  const claves = await getJson<{ snapshots: KeySnapshot[] }>(`${args.url}/api/transparency/keys`);

  const audit = auditPublished({ catalogue: catalogo.snapshots, keys: claves.snapshots });
  if (!audit.ok) {
    for (const problem of audit.problems) console.error(`✗ ${problem}`);
    console.error("Sin firmas y cadenas válidas no hay nada que atestiguar.");
    process.exitCode = 1;
    return;
  }

  const seen = readSeen(args.file);
  const problems = compareWithWitness(seen, audit.entries);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    console.error(
      "La instancia no coincide con lo que el testigo ya había apuntado: o reescribió su historia, o perdió instantáneas.",
    );
    process.exitCode = 1;
    return;
  }

  // Y que la raíz nueva **contenga** la que el testigo ya apuntó: comparar el
  // fichero pilla una raíz reescrita, pero no una historia paralela. Con la
  // prueba de consistencia, cualquier cosa que no sea una continuación de lo
  // apuntado se nota sin guardar el árbol entero.
  const problema = await checkConsistency(args.url, seen, audit.entries);
  if (problema) {
    console.error(`✗ ${problema}`);
    console.error("La instancia no puede demostrar que su directorio continúe el que el testigo ya vio.");
    process.exitCode = 1;
    return;
  }

  if (args.check) {
    console.log(`✓ ${seen.length} entradas apuntadas siguen cuadrando con lo publicado`);
    return;
  }

  const nuevas = freshEntries(seen, audit.entries);
  if (nuevas.length > 0) {
    mkdirSync(path.dirname(args.file), { recursive: true });
    appendFileSync(args.file, formatWitness(nuevas));
  }
  console.log(`✓ ${nuevas.length} entradas nuevas apuntadas en ${args.file}`);
  console.log(
    "Guarda ese fichero fuera de este servidor y publícalo: ahí está su valor como testigo.",
  );
}

void main();
