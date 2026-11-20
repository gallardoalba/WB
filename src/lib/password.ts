import { randomBytes, scrypt, timingSafeEqual, scryptSync, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

const KEY_LENGTH = 64;
/** `promisify` pierde la sobrecarga con opciones: se declara a mano. */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Parámetros con los que se firma un hash nuevo.
 *
 * Van escritos en el propio hash —`scrypt$N,r,p$sal$hash`— para que subirlos
 * más adelante no invalide lo guardado: al verificar se usan los del hash, no
 * los actuales. Antes el formato era `scrypt$sal$hash` y estos valores solo
 * existían en el código, así que cambiarlos habría dejado fuera a todas las
 * cuentas.
 */
const CURRENT = { N: 32_768, r: 8, p: 1 } satisfies Required<Pick<ScryptOptions, "N" | "r" | "p">>;
/** Lo que usaba el formato antiguo (`scrypt$sal$hash`, sin parámetros). */
const LEGACY = { N: 16_384, r: 8, p: 1 };

/**
 * Hash señuelo de una contraseña aleatoria que nadie conoce. Se verifica contra
 * él cuando el correo no existe para que el login tarde lo mismo y no se pueda
 * averiguar qué cuentas están registradas midiendo tiempos.
 */
export const DUMMY_PASSWORD_HASH =
  "scrypt$771a3fa5f2c6298607524dcefb07f662$1b45eae6206c0e4fd5a4e6a82f32a1a3f1a2ad57fc9c81526066045a75b926512121e5f7249379730b6f063b2cbb710bb6c646d0b253419f63534059039814fa";

type Params = { N: number; r: number; p: number };

function paramsOf(spec: string | undefined): Params | null {
  if (!spec) return LEGACY;
  const [n, r, p] = spec.split(",").map((value) => Number.parseInt(value, 10));
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return null;
  if (n < 1024 || r < 1 || p < 1 || n > 1 << 20 || r > 64 || p > 16) return null;
  return { N: n, r, p };
}

const spec = ({ N, r, p }: Params) => `${N},${r},${p}`;

/** `maxmem` por encima de 128·N·r (32 MB con los parámetros actuales). */
const MAXMEM = 64 * 1024 * 1024;
const options = (params: Params) => ({ ...params, maxmem: MAXMEM });

/** Asíncrono: no bloquea el bucle de eventos durante el login. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH, options(CURRENT))) ;
  return `scrypt$${spec(CURRENT)}$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, ...rest] = stored.split("$");
  if (scheme !== "scrypt") return false;
  // Formato nuevo (4 partes) o antiguo (3): el segundo campo es la sal cuando
  // no hay parámetros explícitos.
  const withParams = rest.length === 3;
  const [head, salt, hash] = withParams ? rest : [undefined, rest[0], rest[1]];
  if (!salt || !hash) return false;
  const params = paramsOf(head);
  if (!params) return false;
  const expected = Buffer.from(hash, "hex");
  const candidate = await scryptAsync(password, salt, KEY_LENGTH, options(params));
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(expected, candidate);
}

/**
 * `true` si el hash se hizo con parámetros más débiles que los actuales: quien
 * pueda volver a guardarlo (al iniciar sesión) debería hacerlo.
 */
export function needsRehash(stored: string): boolean {
  const [scheme, ...rest] = stored.split("$");
  if (scheme !== "scrypt" || rest.length !== 3) return true;
  const params = paramsOf(rest[0]);
  if (!params) return true;
  return params.N < CURRENT.N || params.r < CURRENT.r || params.p < CURRENT.p;
}

/** Solo para herramientas de línea de comandos; nunca en una petición. */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH, options(CURRENT));
  return `scrypt$${spec(CURRENT)}$${salt}$${derived.toString("hex")}`;
}
