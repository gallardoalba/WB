/**
 * Formato canónico del protocolo v2.
 *
 * Las cadenas que se firman viven aquí, sin dependencias, porque las usan los
 * dos lados: el cliente las firma con libolm y el servidor las verifica con
 * `node:crypto`. Si cada lado las construyera por su cuenta, un cambio en una
 * dejaría el protocolo mudo.
 */

export const BUNDLE_PREFIX = "wanderbibliothek:v2:bundle";
export const ONE_TIME_KEY_PREFIX = "wanderbibliothek:v2:otk";

/** Lo que firma un dispositivo sobre sí mismo: identificador y sus dos claves. */
export function bundleMessage(deviceId: string, identityKey: string, signingKey: string): string {
  return [BUNDLE_PREFIX, deviceId, identityKey, signingKey].join("|");
}

/** Lo que firma un dispositivo sobre cada clave de un solo uso que publica. */
export function oneTimeKeyMessage(deviceId: string, keyId: string, key: string): string {
  return [ONE_TIME_KEY_PREFIX, deviceId, keyId, key].join("|");
}
