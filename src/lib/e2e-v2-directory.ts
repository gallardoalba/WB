/**
 * Comprobación de que un dispositivo está en el directorio firmado, en el
 * cliente.
 *
 * El paquete de un dispositivo se firma a sí mismo: demuestra que quien lo
 * publica tiene su clave privada, no que el servidor lo publicara cuando dice ni
 * que no haya otro juego de claves en otra historia del directorio. Esto añade
 * las dos comprobaciones que faltaban:
 *
 * 1. **Inclusión**: la línea del dispositivo, con su clave de identidad, lleva
 *    por las ramas de Merkle hasta la raíz firmada.
 * 2. **Firma de la instantánea**: la raíz la firma el operador. La clave de
 *    firma se **fija** la primera vez, así que cambiarla más adelante se nota.
 *
 * La firma se verifica con libolm (`Utility.ed25519_verify`), que ya está
 * cargado y es el mismo verificador que usa el resto del protocolo: no hay una
 * segunda implementación de firmas que pueda discrepar.
 */
import { verifySignature } from "./e2e-v2";
import { KEY_MESSAGE_VERSION } from "./e2e-v2-format";

export type MerkleStep = { hash: string; side: "left" | "right" };

export type DeviceProof = {
  line: string;
  index: number;
  branch: MerkleStep[];
  root: string;
};

export type KeySnapshotHeader = {
  id: string;
  createdAt: string;
  itemCount: number;
  merkleRoot: string;
  previousRoot: string | null;
  signature: string | null;
  publicKey: string | null;
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const HASH = /^[0-9a-f]{64}$/;

/**
 * Sube la línea hasta la raíz con las ramas que da el servidor.
 *
 * Si el servidor cambia una sola hoja —o la raíz— la cadena deja de cuadrar.
 * Además de calcular, **valida la forma**: un índice que no es un entero, un
 * lado que no es `left` ni `right` o un hash que no es un SHA-256 en hexadecimal
 * son pruebas mal formadas. Hoy una prueba así no falsifica nada —habría que
 * acertar la raíz firmada— pero aceptar estructuras inválidas es una puerta que
 * no hace falta dejar abierta.
 */
export async function verifyInclusion(proof: DeviceProof): Promise<boolean> {
  if (!Number.isSafeInteger(proof.index) || proof.index < 0) return false;
  if (!HASH.test(proof.root)) return false;
  for (const step of proof.branch) {
    if (step.side !== "left" && step.side !== "right") return false;
    if (!HASH.test(step.hash)) return false;
  }
  let hash = await sha256(`leaf:${proof.line}`);
  for (const step of proof.branch) {
    hash =
      step.side === "left"
        ? await sha256(`node:${step.hash}${hash}`)
        : await sha256(`node:${hash}${step.hash}`);
  }
  return hash === proof.root;
}

/** El mensaje exacto que firma el operador sobre una instantánea del directorio. */
export function snapshotMessage(snapshot: KeySnapshotHeader): string {
  return [
    KEY_MESSAGE_VERSION,
    snapshot.id,
    snapshot.createdAt,
    String(snapshot.itemCount),
    snapshot.merkleRoot,
    snapshot.previousRoot ?? "",
  ].join("\n");
}

/**
 * La clave pública viaja en formato SPKI; libolm verifica con la clave cruda de
 * 32 bytes que va al final de ese DER.
 */
const ED25519_SPKI_PREFIX = "302a300506032b6570032100";

function unpadded(value: string): string {
  return value.replace(/=+$/, "");
}

function rawKeyFromSpki(publicKeyBase64: string): string | null {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(publicKeyBase64), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
  const prefix = bytes.slice(0, 12);
  const expected = Uint8Array.from(ED25519_SPKI_PREFIX.match(/.{2}/g)!, (pair) =>
    Number.parseInt(pair, 16),
  );
  if (bytes.length !== 44 || prefix.some((byte, index) => byte !== expected[index])) return null;
  return unpadded(btoa(String.fromCharCode(...bytes.slice(12))));
}

export async function verifySnapshotSignature(snapshot: KeySnapshotHeader): Promise<boolean> {
  if (!snapshot.signature || !snapshot.publicKey) return false;
  const raw = rawKeyFromSpki(snapshot.publicKey);
  if (!raw) return false;
  // libolm usa base64 **sin relleno** (`=`) en claves y firmas; el operador las
  // publica en base64 normal de Node, que sí lo lleva.
  return verifySignature(raw, snapshotMessage(snapshot), unpadded(snapshot.signature));
}

/** A quién tiene que pertenecer la línea de la prueba. */
export type ExpectedDevice = { userId: string; deviceId: string; identityKey: string };

/**
 * Comprueba la prueba completa: el dispositivo está en el árbol y el árbol lo
 * firmó el operador.
 *
 * La línea tiene que ser **exactamente** la de esa cuenta y ese dispositivo.
 * Buscar solo la clave de identidad dentro del texto no ata nada: el
 * `deviceId` lo elige el cliente y es público, así que una cuenta hostil puede
 * publicar un dispositivo con el mismo id y su propia clave, y el servidor
 * podría enseñar esa línea —válida y firmada— como si fuera la del
 * destinatario. Lo que se compara es el principio canónico
 * `cuenta|device:<id>|<clave>|`, no una subcadena.
 */
export async function verifyDeviceProof(
  proof: DeviceProof,
  snapshot: KeySnapshotHeader,
  expected: ExpectedDevice,
): Promise<{ ok: boolean; reason?: string }> {
  if (proof.root !== snapshot.merkleRoot) {
    return { ok: false, reason: "La prueba no es de la instantánea que se publicó." };
  }
  const prefix = `${expected.userId}|device:${expected.deviceId}|${expected.identityKey}|`;
  if (!proof.line.startsWith(prefix)) {
    return { ok: false, reason: "La prueba es de otra cuenta o de otro dispositivo." };
  }
  // La línea lleva el estado de retirada en el último campo: `revoked:-` es
  // activo. Sin esta comprobación, la prueba de un aparato retirado —que sigue
  // en el árbol— se aceptaría como si estuviera vivo.
  const fields = proof.line.split("|");
  if (fields.length !== 5) {
    return { ok: false, reason: "La línea del directorio no tiene el formato esperado." };
  }
  if (fields[4] !== "revoked:-") {
    return { ok: false, reason: "Ese dispositivo está retirado en el directorio." };
  }
  if (!Number.isSafeInteger(snapshot.itemCount) || proof.index >= snapshot.itemCount) {
    return { ok: false, reason: "La prueba apunta fuera de la instantánea." };
  }
  if (!(await verifyInclusion(proof))) {
    return { ok: false, reason: "La prueba no llega a la raíz firmada." };
  }
  if (!(await verifySnapshotSignature(snapshot))) {
    return { ok: false, reason: "La instantánea no está firmada por su clave." };
  }
  return { ok: true };
}
