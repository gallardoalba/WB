/**
 * Copia de seguridad consistente de la base SQLite.
 *
 *   npm run db:backup            → .data/backups/wanderbibliothek-<fecha>.db
 *
 * Usa la API `.backup()` de SQLite: no copia el fichero en caliente (con WAL eso
 * puede dar una instantánea incoherente).
 */
import Database from "better-sqlite3";
import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { encryptBackup } from "./backup-crypto";

async function main() {
  const source = process.env.WANDERBIBLIOTHEK_DB ?? path.join(process.cwd(), ".data", "wanderbibliothek.db");
  const targetDir =
    process.env.WANDERBIBLIOTHEK_BACKUP_DIR ?? path.join(process.cwd(), ".data", "backups");

  try {
    statSync(source);
  } catch {
    console.error(`No existe la base de datos en ${source}`);
    process.exit(1);
  }

  mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(targetDir, `wanderbibliothek-${stamp}.db`);

  const db = new Database(source, { readonly: true });
  await db.backup(target);
  db.close();

  // La copia contiene hashes y sesiones: mismos permisos que la base.
  try {
    chmodSync(target, 0o600);
  } catch {
    // Sistemas sin permisos POSIX.
  }

  // Verificación de que la copia se puede leer y está íntegra.
  const check = new Database(target, { readonly: true });
  const integrity = String(check.pragma("integrity_check", { simple: true }));
  check.close();
  if (integrity !== "ok") {
    console.error(`La copia no pasó integrity_check: ${integrity}`);
    process.exit(1);
  }

  // El modo `wal` viaja en la cabecera de la base, así que abrir la copia deja
  // `-shm`/`-wal` al lado. La rotación solo miraba `*.db`/`*.db.enc` y esos
  // sidecars se acumulaban para siempre (en el servidor y en la copia externa).
  for (const sufijo of ["-shm", "-wal"]) {
    try {
      unlinkSync(`${target}${sufijo}`);
    } catch {
      // No siempre existen: SQLite solo los crea si abrió en modo escritura.
    }
  }

  // Si hay clave, la copia se guarda cifrada y el .db plano se elimina.
  let finalFile = target;
  if (process.env.WANDERBIBLIOTHEK_BACKUP_KEY) {
    finalFile = `${target}.enc`;
    encryptBackup(target, finalFile);
    unlinkSync(target);
    console.log(`Copia cifrada en ${finalFile}`);
  }

  // Rotación: se conservan las N copias más recientes.
  const keep = Math.max(1, Number(process.env.WANDERBIBLIOTHEK_BACKUP_KEEP ?? 14) || 14);
  const backups = readdirSync(targetDir)
    .filter((name) => /^wanderbibliothek-.*\.db(\.enc)?$/.test(name))
    .sort()
    .reverse();
  for (const old of backups.slice(keep)) {
    try {
      unlinkSync(path.join(targetDir, old));
      console.log(`Copia antigua eliminada: ${old}`);
    } catch (error) {
      console.warn(`No se pudo borrar ${old}`, error);
    }
  }

  // Barrido de los sidecars que dejaron las versiones anteriores del script.
  const restos = readdirSync(targetDir).filter((name) =>
    /^wanderbibliothek-.*\.db-(shm|wal)$/.test(name),
  );
  for (const resto of restos) {
    try {
      unlinkSync(path.join(targetDir, resto));
    } catch {
      // Si otro proceso lo tiene abierto, se queda para la próxima.
    }
  }
  if (restos.length > 0) console.log(`Sidecars huérfanos retirados: ${restos.length}`);

  // Gancho opcional para copia externa (rsync, rclone, S3…).
  const hook = process.env.WANDERBIBLIOTHEK_BACKUP_HOOK;
  if (hook) {
    try {
      execFileSync("sh", ["-c", hook], {
        stdio: "inherit",
        env: { ...process.env, BACKUP_FILE: finalFile },
      });
    } catch (error) {
      console.error("El gancho de copia externa falló", error);
      process.exit(1);
    }
  }

  console.log(`Copia creada en ${finalFile} (integridad OK, se conservan ${keep})`);
}

void main();
