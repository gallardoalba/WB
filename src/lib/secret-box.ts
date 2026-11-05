import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ApiError } from "./errors";

/**
 * Cifra secretos reversibles en la base: el secreto TOTP y los datos de envío.
 *
 * ## Formato
 *
 * `enc:v2:<keyId>:<flags>:<iv>.<tag>.<datos>` (todo en base64url salvo el id)
 *
 * - `keyId`: con qué clave se cifró, para poder **rotar** sin perder nada.
 * - `flags`: `a` si el criptograma va atado a un contexto (`AAD`), `-` si no.
 *
 * Los valores antiguos con `enc:v1:` (sin id ni contexto) se siguen leyendo.
 *
 * ## Claves
 *
 * - `APP_ENCRYPTION_KEY`: clave con la que se **escribe**. 32 bytes en hex o
 *   base64. Obligatoria.
 * - `APP_ENCRYPTION_OLD_KEYS`: claves anteriores, solo para leer, separadas por
 *   comas (admite `id:clave` si se fijó un id a mano). Sin esto, rotar la clave
 *   dejaría ilegibles los secretos ya guardados.
 * - `APP_ENCRYPTION_KEY_ID`: id legible para la clave activa. Si falta se usa
 *   un prefijo del SHA-256 de la propia clave, que es estable entre despliegues.
 *
 * ## Atado al contexto (AAD)
 *
 * Cifrar sin contexto permite mover un criptograma de una fila a otra (quien
 * pueda escribir en la base) y que la aplicación lo descifre tan contenta. Con
 * `context` (por ejemplo `totp:usr_1` o `ship:req_9:ship_number`) el descifrado
 * solo funciona en su sitio.
 */
const V2 = "enc:v2:";
const V1 = "enc:v1:";

/** Texto plano heredado: solo en desarrollo y con la bandera explícita. */
function allowPlaintext(): boolean {
  return process.env.WANDERBIBLIOTHEK_ALLOW_PLAINTEXT === "1";
}

/** Interpreta una clave de 32 bytes en hex o base64. */
function parseKey(raw: string, variable: string): Buffer {
  const value = raw.trim();
  if (!value) throw new ApiError(500, `${variable} está vacía.`);
  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new ApiError(500, `${variable} debe tener 32 bytes (hex o base64).`);
  }
  return key;
}

/** Id estable de una clave: los 12 primeros dígitos hex de su SHA-256. */
function derivedId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

type Ring = { activeId: string; active: Buffer; old: Map<string, Buffer> };

let cachedRing: { signature: string; ring: Ring } | null = null;

function keyRing(): Ring | null {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim() ?? "";
  const oldRaw = process.env.APP_ENCRYPTION_OLD_KEYS?.trim() ?? "";
  const explicitId = process.env.APP_ENCRYPTION_KEY_ID?.trim() ?? "";
  const signature = `${raw}|${oldRaw}|${explicitId}`;
  if (cachedRing?.signature === signature) return cachedRing.ring;
  if (!raw) return null;

  const active = parseKey(raw, "APP_ENCRYPTION_KEY");
  const old = new Map<string, Buffer>();
  for (const entry of oldRaw.split(",").map((item) => item.trim()).filter(Boolean)) {
    // `id:clave` o solo `clave`; el id por defecto se deriva igual que el activo.
    const separator = entry.indexOf(":");
    const explicit = separator > 0 ? entry.slice(0, separator) : "";
    const key = parseKey(
      separator > 0 ? entry.slice(separator + 1) : entry,
      "APP_ENCRYPTION_OLD_KEYS",
    );
    old.set(explicit || derivedId(key), key);
  }

  const ring: Ring = { activeId: explicitId || derivedId(active), active, old };
  cachedRing = { signature, ring };
  return ring;
}

/** Solo para pruebas: olvida el anillo cacheado tras cambiar el entorno. */
export function resetSecretBoxCache(): void {
  cachedRing = null;
}

export function encryptSecret(plain: string, context = ""): string {
  const ring = keyRing();
  if (!ring) {
    if (!allowPlaintext()) {
      throw new ApiError(
        500,
        "Falta APP_ENCRYPTION_KEY: no se puede guardar el secreto. Configúrala antes de usar la aplicación.",
      );
    }
    console.warn(
      "[secrets] WANDERBIBLIOTHEK_ALLOW_PLAINTEXT=1: secreto en claro (solo desarrollo).",
    );
    return plain;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.active, iv);
  if (context) cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const flags = context ? "a" : "-";
  return `${V2}${ring.activeId}:${flags}:${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(value: string, context = ""): string {
  if (value.startsWith(V2)) return decryptV2(value, context);
  if (value.startsWith(V1)) return decryptV1(value);
  // Texto plano heredado (bases de desarrollo creadas sin clave).
  return value;
}

function decryptV2(value: string, context: string): string {
  const ring = keyRing();
  if (!ring) {
    throw new ApiError(500, "Falta APP_ENCRYPTION_KEY para leer los secretos guardados.");
  }
  const rest = value.slice(V2.length);
  const first = rest.indexOf(":");
  const second = rest.indexOf(":", first + 1);
  if (first < 1 || second < 0) {
    throw new ApiError(500, "El secreto guardado no tiene un formato válido.");
  }
  const keyId = rest.slice(0, first);
  const flags = rest.slice(first + 1, second);
  const parts = rest.slice(second + 1).split(".");
  if (parts.length !== 3) throw new ApiError(500, "El secreto guardado no tiene un formato válido.");

  const key = keyId === ring.activeId ? ring.active : ring.old.get(keyId);
  if (!key) {
    throw new ApiError(
      500,
      "Falta la clave antigua en APP_ENCRYPTION_OLD_KEYS: no se puede leer el secreto.",
    );
  }
  return open(key, parts as [string, string, string], flags === "a" ? context : "", flags === "a");
}

/** Valores anteriores al anillo de claves: sin id de clave ni contexto. */
function decryptV1(value: string): string {
  const ring = keyRing();
  if (!ring) {
    throw new ApiError(500, "Falta APP_ENCRYPTION_KEY para leer los secretos guardados.");
  }
  const parts = value.slice(V1.length).split(".");
  if (parts.length !== 3) throw new ApiError(500, "El secreto guardado no tiene un formato válido.");
  const tuple = parts as [string, string, string];
  // Se prueba la clave activa y, si no abre, las antiguas: así una rotación no
  // deja atrás los valores que todavía no se han vuelto a cifrar.
  try {
    return open(ring.active, tuple, "", false);
  } catch (error) {
    for (const key of ring.old.values()) {
      try {
        return open(key, tuple, "", false);
      } catch {
        // Se prueba la siguiente.
      }
    }
    throw error;
  }
}

function open(key: Buffer, parts: [string, string, string], context: string, withAad: boolean): string {
  const [ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  if (withAad) decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Contexto del secreto TOTP de una cuenta. */
export function totpContext(userId: string): string {
  return `totp:${userId}`;
}

/** Contexto de un campo de envío: atado a la solicitud y a la columna. */
export function shipContext(requestId: string, field: string): string {
  return `ship:${requestId}:${field}`;
}

/** True si el valor ya está cifrado con el formato actual o el heredado. */
export function isEncrypted(value: string | null | undefined): boolean {
  return Boolean(value && (value.startsWith(V2) || value.startsWith(V1)));
}

/** Id de la clave con la que se escribe (útil para informes y traspasos). */
export function activeKeyId(): string | null {
  return keyRing()?.activeId ?? null;
}
