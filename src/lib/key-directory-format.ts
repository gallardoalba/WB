/**
 * Formato canónico de las líneas del directorio de claves.
 *
 * Vive aparte —sin dependencias— porque lo usan tres sitios que no pueden
 * importarse entre sí sin un ciclo: la instantánea (`transparency.ts`), los
 * puntos que apuntan un cambio (`repo/devices.ts`, `repo/users.ts`) y la
 * migración que rellena el registro la primera vez.
 *
 * La hoja de un dispositivo lleva el estado de retirada: sin él, la prueba de
 * inclusión demuestra que el aparato *estuvo* en el directorio, nunca que siga
 * activo. `revoked:-` significa activo; con fecha, retirado.
 */

export function deviceDirectoryLine(input: {
  userId: string;
  deviceId: string;
  identityKey: string;
  /**
   * Clave Ed25519 del dispositivo.
   *
   * Va en la hoja firmada para que el servidor no pueda cambiar solo la clave
   * de firma: la identidad Curve25519 y la firma Ed25519 quedan atadas al
   * mismo compromiso de transparencia y el cliente no tiene que confiar en la
   * lista de dispositivos para fijar la segunda.
   */
  signingKey: string;
  updatedAt: string;
  revokedAt: string | null;
}): string {
  return [
    input.userId,
    `device:${input.deviceId}`,
    input.identityKey,
    input.signingKey,
    input.updatedAt,
    `revoked:${input.revokedAt ?? "-"}`,
  ].join("|");
}

export function slotDirectoryLine(input: {
  userId: string;
  platform: string;
  keyId: string;
  updatedAt: string;
}): string {
  return [input.userId, input.platform, input.keyId, input.updatedAt].join("|");
}

/**
 * Lápida de una ranura v1.
 *
 * A diferencia de un dispositivo v2, una ranura de v1 no tenía estado de
 * retirada. Al borrar la cuenta sus claves desaparecen de `user_keys`, pero el
 * registro append-only conservaría la última línea como si siguiera activa.
 * Esta línea deja constancia de que la cuenta ya no publica esa ranura.
 */
export function revokedSlotDirectoryLine(input: {
  userId: string;
  platform: string;
  at: string;
}): string {
  return [input.userId, input.platform, `revoked:${input.at}`, input.at].join("|");
}
