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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { KeySnapshot, TransparencySnapshot } from "../src/lib/transparency";
import {
  auditPublished,
  compareWithWitness,
  formatWitness,
  freshEntries,
  parseWitness,
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

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
  return (await response.json()) as T;
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

  const seen = existsSync(args.file) ? parseWitness(readFileSync(args.file, "utf8")) : [];
  const problems = compareWithWitness(seen, audit.entries);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    console.error(
      "La instancia no coincide con lo que el testigo ya había apuntado: o reescribió su historia, o perdió instantáneas.",
    );
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
