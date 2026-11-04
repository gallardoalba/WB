/**
 * Recuperación de emergencia: desactiva la verificación en dos pasos de una
 * cuenta desde el servidor (p. ej. si se perdió el dispositivo).
 *
 *   npm run admin:2fa-off -- admin@ejemplo.com
 */
import { getDb } from "../src/lib/db";

const [, , rawEmail] = process.argv;
const email = rawEmail?.trim().toLowerCase();

if (!email) {
  console.error("Uso: npm run admin:2fa-off -- <email>");
  process.exit(1);
}

const db = getDb();
const row = db.prepare("SELECT id, name FROM users WHERE email = ?").get(email) as
  | { id: string; name: string }
  | undefined;

if (!row) {
  console.error(`No existe ninguna cuenta con ${email}.`);
  process.exit(1);
}

const { changes } = db
  .prepare(
    "UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?",
  )
  .run(row.id);

console.log(
  changes > 0
    ? `Verificación en dos pasos desactivada para ${row.name} <${email}>.`
    : "No había nada que desactivar.",
);
