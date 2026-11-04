/**
 * TOTP (RFC 6238) sin dependencias externas.
 *
 * Se usa HMAC-SHA1 de 6 dígitos y pasos de 30 s, el perfil que aceptan
 * Google Authenticator, Aegis, 1Password y similares.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160 bits de entropía, como recomienda la RFC. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(at: number = Date.now()): number {
  return Math.floor(at / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(secret: string, step: number): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Devuelve el paso aceptado o null. `afterStep` impide reutilizar un código:
 * solo valen pasos posteriores al último consumido.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { at?: number; window?: number; afterStep?: number } = {},
): number | null {
  const candidate = code.replace(/\D/g, "");
  if (candidate.length !== TOTP_DIGITS) return null;
  const window = options.window ?? 1;
  const afterStep = options.afterStep ?? 0;
  const current = totpStep(options.at ?? Date.now());

  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (step <= 0 || step <= afterStep) continue;
    const expected = totpCode(secret, step);
    const left = Buffer.from(candidate);
    const right = Buffer.from(expected);
    if (left.length === right.length && timingSafeEqual(left, right)) return step;
  }
  return null;
}

export function otpauthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`Wanderbibliothek:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer: "Wanderbibliothek",
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
