/**
 * Copia de seguridad consistente de la base SQLite.
 *
 *   npm run db:backup            → .data/backups/book2peer-<fecha>.db
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
  const source = process.env.BOOK2PEER_DB ?? path.join(process.cwd(), ".data", "book2peer.db");
  const targetDir =
    process.env.BOOK2PEER_BACKUP_DIR ?? path.join(process.cwd(), ".data", "backups");

  try {
    statSync(source);
  } catch {
    console.error(`No existe la base de datos en ${source}`);
    process.exit(1);
  }

  mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(targetDir, `book2peer-${stamp}.db`);

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

  // Si hay clave, la copia se guarda cifrada y el .db plano se elimina.
  let finalFile = target;
  if (process.env.BOOK2PEER_BACKUP_KEY) {
    finalFile = `${target}.enc`;
    encryptBackup(target, finalFile);
    unlinkSync(target);
    console.log(`Copia cifrada en ${finalFile}`);
  }

  // Rotación: se conservan las N copias más recientes.
  const keep = Math.max(1, Number(process.env.BOOK2PEER_BACKUP_KEEP ?? 14) || 14);
  const backups = readdirSync(targetDir)
    .filter((name) => /^book2peer-.*\.db(\.enc)?$/.test(name))
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

  // Gancho opcional para copia externa (rsync, rclone, S3…).
  const hook = process.env.BOOK2PEER_BACKUP_HOOK;
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
