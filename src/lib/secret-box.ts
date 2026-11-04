import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "./errors";

/**
 * Cifra secretos reversibles en la base (por ahora, el secreto TOTP).
 *
 * `APP_ENCRYPTION_KEY` debe ser 32 bytes en hexadecimal (64 caracteres) o
 * base64. En producción es obligatoria; en desarrollo, si falta, se guarda en
 * claro para no romper el flujo local (y se avisa en consola).
 */
const PREFIX = "enc:v1:";

function encryptionKey(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new ApiError(500, "APP_ENCRYPTION_KEY debe tener 32 bytes (hex o base64).");
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiError(500, "Configura APP_ENCRYPTION_KEY para guardar secretos.");
    }
    console.warn("[secrets] APP_ENCRYPTION_KEY no está definida: secreto en claro (solo desarrollo).");
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const key = encryptionKey();
  if (!key) {
    throw new ApiError(500, "Falta APP_ENCRYPTION_KEY para leer el secreto.");
  }
  const [ivPart, tagPart, dataPart] = value.slice(PREFIX.length).split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new ApiError(500, "El secreto guardado no tiene un formato válido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
