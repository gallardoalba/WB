/**
 * Simulacro de restauración en una instalación limpia.
 *
 *   npm run db:restore-drill                    → la copia más reciente
 *   npm run db:restore-drill -- /ruta/copia.db.enc
 *   npm run db:restore-drill -- --target /tmp/wb-drill /ruta/copia.db.enc
 *
 * `db:verify` comprueba que una copia se abre y se lee. Esto va un paso más
 * allá y reproduce el día del incidente: descifra la copia en un directorio
 * **vacío**, la abre como lo haría una instalación nueva y le aplica las
 * migraciones del código actual. Si la copia viene de una versión anterior, se
 * migra aquí; si viene de una versión **más nueva**, se rechaza en vez de
 * arriesgar datos.
 *
 * Con `--target` conserva la base restaurada para inspeccionarla (y para que
 * `deploy/restore-drill.sh` arranque la imagen contra ella). Sin `--target`
 * usa un directorio temporal que se borra al terminar.
 */
import Database from "better-sqlite3";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SCHEMA_VERSION } from "../src/lib/db/schema";
import { migrate } from "../src/lib/db/migrations";
import { decryptBackup } from "./backup-crypto";
import { latestBackup } from "./verify-backup";

/** Tablas sin las cuales la aplicación no puede arrancar con esta copia. */
const REQUIRED_TABLES = ["users", "sessions", "books", "listings", "requests", "messages"];

/** Tablas que se cuentan en el informe. */
const COUNTED_TABLES = ["users", "books", "listings", "requests", "messages", "user_keys"];

export type RestoreReport = {
  backup: string;
  restoredTo: string;
  encrypted: boolean;
  bytes: number;
  integrity: string;
  schemaBefore: number;
  schemaAfter: number;
  expectedSchema: number;
  tables: number;
  rows: Record<string, number>;
};

export type RestoreOptions = {
  backup: string;
  /** Directorio donde dejar la base restaurada. Sin él se usa uno temporal. */
  targetDir?: string;
};

/**
 * Restaura una copia y la deja lista para arrancar. Lanza si no se puede.
 */
export function runRestoreDrill(options: RestoreOptions): RestoreReport {
  const backup = path.resolve(options.backup);
  const encrypted = backup.endsWith(".enc");
  const keep = Boolean(options.targetDir);
  const dir = options.targetDir
    ? (mkdirSync(options.targetDir, { recursive: true }), path.resolve(options.targetDir))
    : mkdtempSync(path.join(tmpdir(), "wanderbibliothek-restore-"));
  const dbPath = path.join(dir, "wanderbibliothek.db");

  try {
    if (encrypted) decryptBackup(backup, dbPath);
    else {
      copyFileSync(backup, dbPath);
      chmodSync(dbPath, 0o600);
    }

    const db = new Database(dbPath);
    try {
      const schemaBefore = Number(db.pragma("user_version", { simple: true }));
      if (schemaBefore > SCHEMA_VERSION) {
        throw new Error(
          `la copia usa el esquema v${schemaBefore} y este código entiende hasta v${SCHEMA_VERSION}: restáurala con la versión nueva de la aplicación`,
        );
      }

      // Igual que en un arranque: la base se migra antes de servir nada.
      migrate(db);

      const schemaAfter = Number(db.pragma("user_version", { simple: true }));
      if (schemaAfter !== SCHEMA_VERSION) {
        throw new Error(
          `el esquema quedó en v${schemaAfter} en vez de v${SCHEMA_VERSION} tras migrar`,
        );
      }

      const integrity = String(db.pragma("integrity_check", { simple: true }));
      if (integrity !== "ok") {
        throw new Error(`la base restaurada está corrupta (integrity_check: ${integrity})`);
      }

      const orphans = db.pragma("foreign_key_check") as unknown[];
      if (orphans.length > 0) {
        throw new Error(`${orphans.length} filas con referencias rotas (foreign_key_check)`);
      }

      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
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
        backup,
        restoredTo: dbPath,
        encrypted,
        bytes: statSync(backup).size,
        integrity,
        schemaBefore,
        schemaAfter,
        expectedSchema: SCHEMA_VERSION,
        tables: tables.length,
        rows,
      };
    } finally {
      db.close();
      // Los sidecars de WAL no forman parte de la instalación restaurada.
      for (const suffix of ["-wal", "-shm"]) {
        try {
          rmSync(`${dbPath}${suffix}`, { force: true });
        } catch {
          // Puede que no existan.
        }
      }
    }
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true });
  }
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const args = process.argv.slice(2);
  let targetDir: string | undefined;
  let file: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      targetDir = args[index + 1];
      if (!targetDir) throw new Error("--target necesita un directorio.");
      index += 1;
    } else if (arg.startsWith("--target=")) {
      targetDir = arg.slice("--target=".length);
    } else if (!arg.startsWith("-")) {
      file = arg;
    } else {
      throw new Error(`opción desconocida: ${arg}`);
    }
  }

  const directory =
    process.env.WANDERBIBLIOTHEK_BACKUP_DIR ?? path.join(process.cwd(), ".data", "backups");
  const backup = file ? path.resolve(file) : latestBackup(directory);
  if (!backup) {
    throw new Error(
      `no hay ninguna copia en ${directory}; indica el fichero: npm run db:restore-drill -- <copia>`,
    );
  }

  const report = runRestoreDrill({ backup, targetDir });
  console.log(
    `Copia: ${path.basename(report.backup)} (${mb(report.bytes)}, ${report.encrypted ? "cifrada" : "EN CLARO"})`,
  );
  console.log(`Integridad: ${report.integrity} · ${report.tables} tablas`);
  console.log(
    report.schemaBefore === report.schemaAfter
      ? `Esquema: v${report.schemaAfter}`
      : `Esquema: v${report.schemaBefore} → v${report.schemaAfter} (migrada con este código)`,
  );
  console.log(
    `Filas: ${Object.entries(report.rows)
      .map(([table, count]) => `${table} ${count}`)
      .join(" · ")}`,
  );
  console.log(`Instalación restaurada: ${report.restoredTo}`);
  console.log("La copia se restaura en una instalación limpia y el código actual la acepta.");
}

if (process.argv[1]?.endsWith("restore-drill.ts")) {
  main().catch((error: unknown) => {
    console.error(
      `La copia NO se puede restaurar en limpio: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  });
}
