/**
 * Marca (o desmarca) el correo de una cuenta como confirmado.
 *
 *   npm run user:verify -- ana@ejemplo.com
 *   npm run user:verify -- ana@ejemplo.com --unverify
 *
 * Existe para cuando el proveedor de correo falla y alguien se queda sin poder
 * publicar: es la alternativa a tocar SQL a mano en producción. El enlace de
 * confirmación sigue siendo el camino normal.
 */
import { getDb } from "../src/lib/db";

const [, , rawEmail, ...flags] = process.argv;
const email = rawEmail?.trim().toLowerCase();
const unverify = flags.includes("--unverify");

if (!email || !email.includes("@")) {
  console.error("Uso: npm run user:verify -- <correo> [--unverify]");
  process.exit(1);
}

const db = getDb();
const user = db
  .prepare("SELECT id, name, email, email_verified_at FROM users WHERE email = ?")
  .get(email) as
  | { id: string; name: string; email: string; email_verified_at: string | null }
  | undefined;

if (!user) {
  console.error(`No existe ninguna cuenta con el correo ${email}.`);
  process.exit(1);
}

if (unverify) {
  db.prepare(
    "UPDATE users SET email_verified_at = NULL WHERE id = ?",
  ).run(user.id);
  console.log(`Correo marcado como NO confirmado para ${user.email} (${user.name}).`);
  process.exit(0);
}

if (user.email_verified_at) {
  console.log(`${user.email} ya estaba confirmado (${user.email_verified_at}).`);
  process.exit(0);
}

db.prepare(
  "UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
).run(user.id);
console.log(`Correo confirmado a mano para ${user.email} (${user.name}).`);
