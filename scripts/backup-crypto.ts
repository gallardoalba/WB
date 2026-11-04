import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const MAGIC = Buffer.from("B2PBK1");

function keyFromEnv(): Buffer {
  const raw = process.env.BOOK2PEER_BACKUP_KEY?.trim();
  if (!raw) throw new Error("Falta BOOK2PEER_BACKUP_KEY.");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("BOOK2PEER_BACKUP_KEY debe tener 32 bytes.");
  return key;
}

/** Cifra una copia con AES-256-GCM: B2PBK1 | iv | tag | ciphertext. */
export function encryptBackup(source: string, destination: string): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromEnv(), iv);
  const plaintext = readFileSync(source);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  writeFileSync(
    destination,
    Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]),
    { mode: 0o600 },
  );
}

export function decryptBackup(source: string, destination: string): void {
  const payload = readFileSync(source);
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("El fichero no es una copia cifrada de Wanderbibliothek.");
  }
  const iv = payload.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = payload.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const data = payload.subarray(MAGIC.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", keyFromEnv(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  writeFileSync(destination, plaintext, { mode: 0o600 });
}
