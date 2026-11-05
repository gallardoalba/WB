/**
 * Crea (o asciende) una cuenta de administración sin depender del sembrado
 * de demostración.
 *
 *   npm run admin:create -- admin@ejemplo.com 'contraseña-larga'
 */
import { hashPasswordSync } from "../src/lib/password";
import { getDb } from "../src/lib/db";
import { randomUUID } from "node:crypto";

const [, , rawEmail, rawPassword] = process.argv;
const email = rawEmail?.trim().toLowerCase();
// La contraseña por argumento queda visible en `ps` y en el historial; se
// admite ADMIN_PASSWORD para pasarla desde el entorno.
const password = rawPassword ?? process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error(
    "Uso: npm run admin:create -- <email> <contraseña>  (o define ADMIN_PASSWORD)",
  );
  process.exit(1);
}
if (password.length < 12) {
  console.error("La contraseña debe tener al menos 12 caracteres.");
  process.exit(1);
}

const db = getDb();
const existing = db
  .prepare("SELECT id FROM users WHERE email = ?")
  .get(email) as { id: string } | undefined;

if (existing) {
  db.prepare("UPDATE users SET is_admin = 1, is_suspended = 0, password_hash = ? WHERE id = ?").run(
    hashPasswordSync(password),
    existing.id,
  );
  console.log(`Cuenta ${email} ascendida a administración y contraseña actualizada.`);
} else {
  const now = (
    db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS ts").get() as { ts: string }
  ).ts;
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, city, bio, is_admin, created_at, locale) VALUES (?, ?, ?, ?, ?, '', 1, ?, 'de')",
  ).run(`usr_${randomUUID()}`, "Administración", email, hashPasswordSync(password), "Stuttgart", now);
  console.log(`Cuenta de administración creada para ${email}.`);
}
