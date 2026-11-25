/**
 * Número de seguridad de los dispositivos v2.
 *
 * Sirve para comprobar **fuera de banda** que las claves de la otra persona son
 * las que son. Es la pieza que cubre el punto ciego que deja el anclaje: fijar
 * la clave en el primer contacto protege de un cambio posterior, pero no de que
 * el primer contacto ya venga sustituido. Comparar este número por una llamada,
 * en persona o por otro canal lo cubre.
 *
 * Se calcula como en Signal: se ordenan los dos lados para que los dos calculen
 * lo mismo, se concatenan los identificadores de todos los dispositivos con sus
 * dos claves públicas y se itera SHA-512 5200 veces. La iteración encarece
 * buscar una colisión por fuerza bruta de prefijo sin costar nada perceptible
 * (unos milisegundos).
 *
 * Incluye **todos** los dispositivos de las dos partes: si alguien añade uno,
 * el número cambia y la comparación anterior deja de valer, que es justo lo que
 * se quiere.
 */
export type DeviceFingerprint = { deviceId: string; identityKey: string; signingKey: string };

/** Iteraciones de la huella (las mismas que usa Signal). */
const ROUNDS = 5200;
/** Bytes que se convierten en dígitos: 6 caracteres por byte, 30 bytes = 60. */
const DIGEST_BYTES = 30;

function sideLines(devices: DeviceFingerprint[]): string {
  // Por unidades de código, no con `localeCompare`: el orden por defecto depende
  // del idioma del navegador (mayúsculas, guiones, guiones bajos), y dos personas
  // en idiomas distintos podrían calcular números diferentes para los mismos
  // aparatos y no cuadrar nunca. Aquí el orden tiene que ser el mismo en
  // cualquier sitio.
  return [...devices]
    .sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0))
    .map((device) => `${device.deviceId}|${device.identityKey}|${device.signingKey}`)
    .join("\n");
}

/**
 * Devuelve el número, o `null` si alguna de las dos partes no tiene ningún
 * dispositivo: sin claves que comparar no hay nada que verificar.
 */
export async function v2SafetyNumber(
  me: DeviceFingerprint[],
  peer: DeviceFingerprint[],
  /** Identidades de las dos cuentas, para atar la huella a sus titulares. */
  userIds: { me?: string; peer?: string } = {},
): Promise<string | null> {
  if (me.length === 0 || peer.length === 0) return null;

  let material: string;
  if (userIds.me && userIds.peer) {
    // Sin los ids, el número solo identifica un conjunto de aparatos: dos
    // cuentas con los mismos fingerprints producían la misma huella. Con los
    // ids, la comparación ata también a quién pertenece cada lado.
    const sides = [
      { id: userIds.me, lines: sideLines(me) },
      { id: userIds.peer, lines: sideLines(peer) },
    ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    material = sides.map((side) => `${side.id}\u0000${side.lines}`).join("\u0000");
  } else {
    // Compatibilidad con el formato anterior cuando solo se pasan aparatos.
    const [first, second] = [sideLines(me), sideLines(peer)].sort();
    material = `${first}\u0000${second}`;
  }
  let digest = new TextEncoder().encode(material);
  for (let round = 0; round < ROUNDS; round += 1) {
    digest = new Uint8Array(await crypto.subtle.digest("SHA-512", digest));
  }

  // Dos dígitos por byte: 30 bytes son 60 dígitos, que se leen en doce grupos.
  return [...digest.slice(0, DIGEST_BYTES)]
    .map((byte) => String(byte % 100).padStart(2, "0"))
    .join("");
}

/** El número en grupos de cinco, que es como se lee en voz alta. */
export function formatSafetyNumber(value: string | null): string | null {
  if (!value) return null;
  return value.match(/.{1,5}/g)?.join(" ") ?? value;
}
