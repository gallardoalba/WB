import { createHash } from "node:crypto";

/**
 * Huella estable de una clave pública ECDH P-256.
 *
 * Es la misma cadena que calcula el navegador en `src/lib/e2e.ts`; si cambia
 * una, hay que cambiar la otra (hay una prueba que lo comprueba).
 */
export function keyIdFromJwk(
  jwk: Pick<JsonWebKey, "kty" | "crv" | "x" | "y">,
): string {
  const canonical = `${jwk.kty}.${jwk.crv}.${jwk.x}.${jwk.y}`;
  return createHash("sha256").update(canonical).digest("base64url");
}
