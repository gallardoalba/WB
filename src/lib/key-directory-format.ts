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
  updatedAt: string;
  revokedAt: string | null;
}): string {
  return [
    input.userId,
    `device:${input.deviceId}`,
    input.identityKey,
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
