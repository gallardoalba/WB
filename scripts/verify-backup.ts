/**
 * Ensayo de restauración: comprueba que una copia **se puede usar**.
 *
 *   npm run db:verify                       → la copia más reciente del directorio
 *   npm run db:verify -- /ruta/copia.db.enc → una copia concreta
 *
 * Una copia que existe no es una copia que restaura. Esto descifra el fichero
 * (con `WANDERBIBLIOTHEK_BACKUP_KEY`), lo abre como lo abriría la aplicación,
 * recorre la base entera con `integrity_check`, comprueba las claves ajenas y
 * cuenta las filas de las tablas que importan. Si algo falla, el mensaje dice
 * qué: es mejor descubrirlo ahora que el día del incidente.
 *
 * El fichero descifrado se crea en un directorio temporal con permisos 0600 y
 * se borra al terminar (`decryptBackup` ya escribe con 0600).
 */
import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decryptBackup } from "./backup-crypto";
import { SCHEMA_VERSION } from "../src/lib/db/schema";

/** Tablas sin las cuales la copia no sirve para arrancar la aplicación. */
const REQUIRED_TABLES = ["users", "sessions", "books", "listings"];

/** Tablas que se cuentan en el informe: lo que alguien mira primero. */
const COUNTED_TABLES = ["users", "books", "listings", "requests", "messages"];

export type BackupReport = {
  file: string;
  encrypted: boolean;
  bytes: number;
  integrity: string;
  schemaVersion: number;
  expectedSchema: number;
  tables: number;
  rows: Record<string, number>;
};

/** Copia más reciente del directorio de copias (la que rotó menos). */
export function latestBackup(directory: string): string | null {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return null;
  }
  const candidates = names
    .filter((name) => /^wanderbibliothek-.*\.db(\.enc)?$/.test(name))
    .map((name) => path.join(directory, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

/**
 * Verifica una copia y devuelve el informe. Lanza si no se puede restaurar:
 * descifrado imposible, base corrupta, claves ajenas rotas o esquema vacío.
 */
export function verifyBackupFile(source: string): BackupReport {
  const encrypted = source.endsWith(".enc");
  const workDir = mkdtempSync(path.join(tmpdir(), "wanderbibliothek-verify-"));
  const plain = encrypted ? path.join(workDir, "copia.db") : source;

  try {
    if (encrypted) decryptBackup(source, plain);

    const db = new Database(plain, { readonly: true, fileMustExist: true });
    try {
      const integrity = String(db.pragma("integrity_check", { simple: true }));
      if (integrity !== "ok") throw new Error(`la copia está corrupta (integrity_check: ${integrity})`);

      // Con las claves ajenas activadas, una fila huérfana se convierte en un
      // error al arrancar; aquí se ve antes.
      const orphans = db.pragma("foreign_key_check") as unknown[];
      if (orphans.length > 0) {
        throw new Error(`${orphans.length} filas con referencias rotas (foreign_key_check)`);
      }

      const schemaVersion = Number(db.pragma("user_version", { simple: true }));
      if (schemaVersion === 0) {
        throw new Error("la base no tiene el esquema aplicado (user_version = 0)");
      }

      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((row) => row.name);
      const present = new Set(tables);
      const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
      if (missing.length > 0) throw new Error(`faltan tablas: ${missing.join(", ")}`);

      const rows: Record<string, number> = {};
      for (const table of COUNTED_TABLES) {
        if (!present.has(table)) continue;
        // El nombre viene de la lista de arriba, nunca de fuera.
        const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
        rows[table] = row.n;
      }

      return {
        file: source,
        encrypted,
        bytes: statSync(source).size,
        integrity,
        schemaVersion,
        expectedSchema: SCHEMA_VERSION,
        tables: tables.length,
        rows,
      };
    } finally {
      db.close();
    }
  } finally {
    // El descifrado es una copia en claro: no se queda en /tmp.
    rmSync(workDir, { recursive: true, force: true });
  }
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const argument = process.argv[2];
  const directory =
    process.env.WANDERBIBLIOTHEK_BACKUP_DIR ?? path.join(process.cwd(), ".data", "backups");
  const file = argument ? path.resolve(argument) : latestBackup(directory);

  if (!file) {
    console.error(`No hay ninguna copia en ${directory}. Indica el fichero: npm run db:verify -- <copia>`);
    process.exit(1);
  }

  try {
    const report = verifyBackupFile(file);
    console.log(`Copia: ${path.basename(report.file)} (${mb(report.bytes)}, ${report.encrypted ? "cifrada" : "EN CLARO"})`);
    console.log(`Integridad: ${report.integrity} · ${report.tables} tablas`);
    if (report.schemaVersion === report.expectedSchema) {
      console.log(`Esquema: v${report.schemaVersion}`);
    } else if (report.schemaVersion < report.expectedSchema) {
      // Restaurar una copia antigua es el caso normal: al arrancar se migra.
      console.log(
        `Esquema: v${report.schemaVersion} (el código está en v${report.expectedSchema}: se migrará al arrancar)`,
      );
    } else {
      console.warn(
        `Aviso: la copia es v${report.schemaVersion} y este código entiende hasta v${report.expectedSchema}. Restaurarla exige la versión nueva de la aplicación.`,
      );
    }
    console.log(
      `Filas: ${Object.entries(report.rows)
        .map(([table, count]) => `${table} ${count}`)
        .join(" · ")}`,
    );
    console.log("La copia se descifra, se abre y se lee entera: la restauración es posible.");
  } catch (error) {
    console.error(
      `La copia NO se puede restaurar: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("verify-backup.ts")) {
  void main();
}
