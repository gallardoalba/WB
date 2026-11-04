import { randomBytes, scrypt, timingSafeEqual, scryptSync } from "node:crypto";
import { promisify } from "node:util";

const KEY_LENGTH = 64;
const scryptAsync = promisify(scrypt);

/**
 * Hash señuelo de una contraseña aleatoria que nadie conoce. Se verifica contra
 * él cuando el correo no existe para que el login tarde lo mismo y no se pueda
 * averiguar qué cuentas están registradas midiendo tiempos.
 */
export const DUMMY_PASSWORD_HASH =
  "scrypt$771a3fa5f2c6298607524dcefb07f662$1b45eae6206c0e4fd5a4e6a82f32a1a3f1a2ad57fc9c81526066045a75b926512121e5f7249379730b6f063b2cbb710bb6c646d0b253419f63534059039814fa";

/** Asíncrono: no bloquea el bucle de eventos durante el login. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const candidate = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(expected, candidate);
}

/** Solo para herramientas de línea de comandos; nunca en una petición. */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, KEY_LENGTH).toString("hex")}`;
}
