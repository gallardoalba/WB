/**
 * Genera el bloque de variables legales para el `EnvironmentFile` del servicio.
 *
 *   npm run legal:env -- --name "Nombre o razón social" \
 *     --address "Calle 1, 00000 Ciudad, Alemania" \
 *     --email privacidad@tudominio.example \
 *     [--register "Vereinsregister …, VR 12345"] [--vat DE000000000] [--phone "+49 …"]
 *
 * Con `--write /etc/wanderbibliothek/env` reescribe solo las líneas LEGAL_*
 * (necesita permisos de escritura, así que normalmente `sudo -E`).
 * Sin `--write` solo imprime el bloque, para pegarlo a mano.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { formatLegalEnv, replaceLegalEnv, validateLegalValues, type LegalValues } from "../src/lib/legal-env";

const USAGE = `Uso:
  npm run legal:env -- --name "…" --address "…" --email "…" \\
    [--register "…"] [--vat "…"] [--phone "…"] [--write /etc/wanderbibliothek/env]

Sin --write solo imprime el bloque; con --write lo deja en el fichero de entorno,
sustituyendo las líneas LEGAL_* anteriores.`;

function parseArgs(argv: string[]): { values: LegalValues; write: string | null; help: boolean } {
  const values: LegalValues = {};
  let write: string | null = null;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    const take = () => {
      index += 1;
      return next ?? "";
    };
    switch (flag) {
      case "--name":
      case "--controller":
        values.controller = take();
        break;
      case "--address":
        values.address = take();
        break;
      case "--email":
      case "--contact":
        values.contact = take();
        break;
      case "--register":
        values.register = take();
        break;
      case "--vat":
        values.vatId = take();
        break;
      case "--phone":
        values.phone = take();
        break;
      case "--write":
        write = take();
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (flag?.startsWith("--")) {
          console.error(`Opción desconocida: ${flag}`);
          help = true;
        }
    }
  }

  return { values, write, help };
}

const { values, write, help } = parseArgs(process.argv.slice(2));

if (help) {
  console.log(USAGE);
  process.exit(values.controller || values.address || values.contact ? 1 : 0);
}

const problems = validateLegalValues(values);
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  console.error(`\n${USAGE}`);
  process.exit(1);
}

const block = formatLegalEnv(values);

if (!write) {
  console.log(block);
  console.log(
    "\nPega este bloque en /etc/wanderbibliothek/env y reinicia el servicio:\n" +
      "  sudo systemctl restart wanderbibliothek\n" +
      "  BASE_URL=https://tu-dominio npm --prefix /srv/wanderbibliothek/current run smoke",
  );
  process.exit(0);
}

const existing = (() => {
  try {
    return readFileSync(write, "utf8");
  } catch {
    return "";
  }
})();

try {
  writeFileSync(write, replaceLegalEnv(existing, block), { mode: 0o600 });
  console.log(`Datos legales escritos en ${write}.`);
  console.log("Reinicia el servicio para que las páginas los publiquen:");
  console.log("  sudo systemctl restart wanderbibliothek");
} catch (error) {
  console.error(`No se pudo escribir en ${write}:`, error instanceof Error ? error.message : error);
  console.error("Ese fichero suele ser de root: repite el comando con sudo -E.");
  process.exit(1);
}
