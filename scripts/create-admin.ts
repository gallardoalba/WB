/**
 * Crea (o asciende) una cuenta de administración o de moderación sin depender
 * del sembrado de demostración.
 *
 *   npm run admin:create -- admin@ejemplo.com 'contraseña-larga'
 *   npm run moderator:create -- moderacion@ejemplo.com 'contraseña-larga'
 */
import { hashPasswordSync } from "../src/lib/password";
import { getDb } from "../src/lib/db";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2).filter((arg) => arg !== "--moderator");
const [rawEmail, rawPassword] = args;
const moderator = process.argv.includes("--moderator");
const email = rawEmail?.trim().toLowerCase();
// La contraseña por argumento queda visible en `ps` y en el historial; se
// admite ADMIN_PASSWORD para pasarla desde el entorno.
const password = rawPassword ?? process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error(
    "Uso: npm run admin:create -- <email> <contraseña>  (o define ADMIN_PASSWORD)\n" +
      "     npm run moderator:create -- <email> <contraseña>  (sin permiso para suspender)",
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
  db.prepare(
    `UPDATE users
        SET is_admin = ?, is_moderator = ?, is_suspended = 0,
            suspended_until = NULL, suspension_reason = NULL, password_hash = ?
      WHERE id = ?`,
  ).run(moderator ? 0 : 1, moderator ? 1 : 0, hashPasswordSync(password), existing.id);
  console.log(
    `Cuenta ${email} ascendida a ${moderator ? "moderación" : "administración"} y contraseña actualizada.`,
  );
} else {
  const now = (
    db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS ts").get() as { ts: string }
  ).ts;
  db.prepare(
    `INSERT INTO users
       (id, name, email, password_hash, city, bio, is_admin, is_moderator, created_at, locale)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'de')`,
  ).run(
    `usr_${randomUUID()}`,
    moderator ? "Moderación" : "Administración",
    email,
    hashPasswordSync(password),
    "Stuttgart",
    moderator ? 0 : 1,
    moderator ? 1 : 0,
    now,
  );
  console.log(
    `Cuenta de ${moderator ? "moderación" : "administración"} creada para ${email}.`,
  );
}
