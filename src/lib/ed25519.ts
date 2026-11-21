/**
 * Verificación de firmas Ed25519 en el servidor.
 *
 * El protocolo v2 firma el paquete de cada dispositivo y **cada** clave de un
 * solo uso con la clave Ed25519 del propio dispositivo. libolm no firma esas
 * claves (X3DH firma su *signed prekey* y olm no tiene equivalente), así que
 * sin esta comprobación el servidor podría cambiar la clave que entrega y
 * quedarse en medio del handshake sin romper ningún MAC.
 *
 * Aquí solo se **verifica**: las claves privadas no salen del dispositivo. La
 * comprobación se hace con `node:crypto` (Ed25519 nativo) para no cargar el WASM
 * de libolm en el servidor.
 */
import { createPublicKey, verify } from "node:crypto";

/** Prefijo DER de una clave pública Ed25519 en formato SPKI (RFC 8410). */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;

/**
 * `true` solo si la firma es válida. Cualquier entrada con la forma equivocada
 * devuelve `false`: nunca se lanza desde aquí, porque el llamador decide si eso
 * es un `400` o un `422`.
 */
export function verifyEd25519(
  publicKeyBase64: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const raw = Buffer.from(publicKeyBase64, "base64");
    const signature = Buffer.from(signatureBase64, "base64");
    if (raw.length !== KEY_BYTES || signature.length !== SIGNATURE_BYTES) return false;
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(message, "utf8"), key, signature);
  } catch {
    return false;
  }
}
