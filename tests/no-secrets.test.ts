import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

/**
 * Detección de secretos en el árbol de trabajo.
 *
 * La plantilla (`deploy/env.example`) se versiona a propósito y está vacía; lo
 * que no puede aparecer es una credencial **real** dentro de un fichero. Es la
 * comprobación que un escáner de secretos haría en el CI, pero sin depender de
 * un servicio: corre en cada `npm test` y también en el portátil.
 *
 * No sustituye a revisar el historial de git (un secreto borrado sigue en los
 * commits); para eso hace falta `gitleaks` o `git filter-repo`. Esto corta el
 * error que se comete a diario: pegar la clave en el repo «un momento».
 */

const ROOT = process.cwd();

/** Directorios que no son código fuente del proyecto. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".data",
  ".vercel",
  "coverage",
  "playwright-report",
  "test-results",
  "backups",
]);

/** Solo se leen ficheros de texto con estas extensiones o estos nombres. */
const SCAN_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".sql",
  ".sh",
  ".conf",
  ".yml",
  ".yaml",
  ".example",
  ".service",
  ".timer",
  ".txt",
];
const SCAN_NAMES = new Set(["Dockerfile", "Makefile", ".env", ".env.example"]);

/**
 * Marcas que aparecen en todos los documentos y pruebas de este repositorio:
 * si la coincidencia las contiene, es un ejemplo y no una credencial.
 */
const PLACEHOLDER = /(example|ejemplo|cambiame|changeme|placeholder|redacted|tu-clave|tu_key|<[^>]{1,60}>|\$\{|\$\(|npm run|openssl|process\.env|\ba{16,}\b|\b0{16,}\b)/i;

const PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "clave privada", pattern: /-----BEGIN [A-Z ]{0,20}PRIVATE KEY-----/ },
  // Brevo (el proveedor de correo del proyecto).
  { name: "clave de Brevo", pattern: /xkeysib-[a-z0-9]{40,}/i },
  { name: "clave de AWS", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "token de GitHub", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "token de Slack", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "clave de Google", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "token de Telegram", pattern: /\b\d{8,10}:AA[0-9A-Za-z_-]{33}/ },
  // Claves de 32 bytes en hexadecimal asignadas a algo que se llama clave.
  {
    name: "clave de 32 bytes",
    pattern: /(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[=:]\s*["']?([a-f0-9]{64})["']?/i,
  },
];

export type Finding = { file: string; line: number; name: string; text: string };

/** Busca credenciales en un texto. Exportada para poder probar el detector. */
export function findSecrets(file: string, content: string): Finding[] {
  const findings: Finding[] = [];
  content.split("\n").forEach((line, index) => {
    for (const { name, pattern } of PATTERNS) {
      if (!pattern.test(line)) continue;
      if (PLACEHOLDER.test(line)) continue;
      findings.push({ file, line: index + 1, name, text: line.trim().slice(0, 120) });
    }
  });
  return findings;
}

/** Ficheros de texto del proyecto, sin dependencias ni artefactos. */
function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* sourceFiles(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (statSync(full).size > 512 * 1024) continue;
    const dotted = entry.name.lastIndexOf(".");
    const extension = dotted === -1 ? "" : entry.name.slice(dotted);
    if (!SCAN_NAMES.has(entry.name) && !SCAN_EXTENSIONS.includes(extension)) continue;
    yield full;
  }
}

test("el detector reconoce credenciales de verdad", () => {
  // Una muestra de cada patrón, escrita de forma que no parezca un ejemplo:
  // si un día un patrón deja de funcionar, esta prueba lo dice.
  const muestras = [
    "BREVO_API_KEY=xkeysib-" + "d".repeat(44),
    "aws_secret = AKIA" + "Q".repeat(16),
    "token: ghp_" + "z".repeat(36),
    "slack = xoxb-" + "1".repeat(12),
    "APP_ENCRYPTION_KEY=" + "9f".repeat(32),
    "-----BEGIN RSA PRIVATE KEY-----",
  ];
  for (const linea of muestras) {
    assert.equal(findSecrets("prueba.ts", linea).length, 1, `no se detectó: ${linea.slice(0, 20)}…`);
  }
  // Y no se queja de la plantilla ni de las pruebas: sería inútil.
  const inocentes = [
    "WANDERBIBLIOTHEK_BACKUP_KEY=",
    'WANDERBIBLIOTHEK_BACKUP_KEY="$(openssl rand -hex 32)"',
    "const KEY_HEX = KEY.repeat(64);",
    "process.env.APP_ENCRYPTION_KEY",
    "Usa una clave de 32 bytes en hexadecimal (64 caracteres).",
  ];
  for (const linea of inocentes) {
    assert.deepEqual(findSecrets("prueba.ts", linea), [], `falso positivo: ${linea}`);
  }
});

test("el árbol de trabajo no contiene secretos", () => {
  const findings: Finding[] = [];
  for (const file of sourceFiles(ROOT)) {
    // Esta prueba contiene las muestras a propósito.
    if (relative(ROOT, file) === join("tests", "no-secrets.test.ts")) continue;
    const content = readFileSync(file, "utf8");
    if (content.includes("\u0000")) continue;
    findings.push(...findSecrets(relative(ROOT, file).split(sep).join("/"), content));
  }

  assert.deepEqual(
    findings.map((item) => `${item.file}:${item.line} ${item.name}`),
    [],
    "hay credenciales en ficheros versionados",
  );
});
