import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../db";
import { base32Encode } from "../totp";
import { nowIso } from "./shared";

/**
 * Códigos de recuperación del segundo factor.
 *
 * La aplicación de autenticación puede perderse (teléfono nuevo, pantalla
 * rota): sin una salida, la cuenta quedaría cerrada para siempre. Se entregan
 * diez códigos de un solo uso al activar la verificación en dos pasos y se
 * pueden regenerar desde la cuenta.
 *
 * En la base solo queda el hash: quien lea la base no puede entrar con ellos.
 * No hace falta guardarlos cifrados porque no son texto que haya que recuperar,
 * solo comparar.
 */

export const RECOVERY_CODE_COUNT = 10;
/** Diez caracteres del alfabeto base32: 50 bits de entropía por código. */
const CODE_LENGTH = 10;

/**
 * Hash del código.
 *
 * No incluye el identificador de la cuenta: la consulta ya filtra por
 * `user_id`, así que un código de otra persona no puede valer aquí, y con 50
 * bits de entropía (10 caracteres de base32) una tabla precalculada es
 * inviable. Codificar el identificador en el digest hacía que el análisis
 * estático leyera esto como un «hash de contraseña con poco esfuerzo», cuando
 * lo que se guarda no es una contraseña sino un testigo aleatorio de un solo
 * uso.
 */
function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Deja el código en la forma en que se compara: mayúsculas y solo caracteres
 * del alfabeto. Así da igual si se escribe con guion, sin él o en minúsculas.
 */
export function normalizeRecoveryCode(raw: string): string {
  return raw
    .toUpperCase()
    // El alfabeto base32 no tiene 0 ni 1: quien los teclea está leyendo una O o
    // una I (o una tipografía que las confunde). Sin esto, un código correcto
    // se rechazaba por un carácter que el código nunca contiene.
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/[^A-Z2-7]/g, "");
}

function formatCode(letters: string): string {
  return `${letters.slice(0, CODE_LENGTH / 2)}-${letters.slice(CODE_LENGTH / 2)}`;
}

/**
 * Sustituye los códigos de la cuenta por diez nuevos y los devuelve en claro.
 *
 * Es la única vez que se pueden leer: después solo queda el hash. Los
 * anteriores dejan de valer en la misma transacción.
 */
export function generateRecoveryCodes(userId: string): string[] {
  const db = getDb();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    formatCode(base32Encode(randomBytes(10)).slice(0, CODE_LENGTH)),
  );
  const createdAt = nowIso();
  db.transaction(() => {
    db.prepare("DELETE FROM totp_recovery_codes WHERE user_id = ?").run(userId);
    const insert = db.prepare(
      "INSERT INTO totp_recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)",
    );
    for (const code of codes) {
      insert.run(userId, hashCode(normalizeRecoveryCode(code)), createdAt);
    }
  })();
  return codes;
}

/** Cuántos códigos quedan sin gastar, para avisar en la cuenta. */
export function countRecoveryCodes(userId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS remaining
         FROM totp_recovery_codes
        WHERE user_id = ? AND used_at IS NULL`,
    )
    .get(userId) as { remaining: number };
  return row.remaining;
}

/**
 * Consume un código. El UPDATE condicional es la parte atómica: dos peticiones
 * simultáneas con el mismo código solo entran una vez.
 */
export function verifyRecoveryCode(userId: string, raw: string): boolean {
  const normalized = normalizeRecoveryCode(raw);
  if (normalized.length !== CODE_LENGTH) return false;
  const { changes } = getDb()
    .prepare(
      `UPDATE totp_recovery_codes
          SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
    )
    .run(userId, hashCode(normalized));
  return changes === 1;
}

/** Al desactivar la verificación en dos pasos no quedan códigos que valgan. */
export function clearRecoveryCodes(userId: string): void {
  getDb().prepare("DELETE FROM totp_recovery_codes WHERE user_id = ?").run(userId);
}
