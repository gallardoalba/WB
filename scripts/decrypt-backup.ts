/**
 * Restaura una copia cifrada:
 *   BOOK2PEER_BACKUP_KEY=... npm run db:decrypt -- copia.db.enc copia.db
 */
import { decryptBackup } from "./backup-crypto";

const [, , source, destination] = process.argv;
if (!source || !destination) {
  console.error("Uso: npm run db:decrypt -- <copia.db.enc> <salida.db>");
  process.exit(1);
}

try {
  decryptBackup(source, destination);
  console.log(`Copia descifrada en ${destination}`);
} catch (error) {
  console.error("No se pudo descifrar la copia:", error instanceof Error ? error.message : error);
  process.exit(1);
}
