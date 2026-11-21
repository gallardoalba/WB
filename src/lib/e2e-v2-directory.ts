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

/**
 * Sube la línea hasta la raíz con las ramas que da el servidor.
 *
 * Si el servidor cambia una sola hoja —o la raíz— la cadena deja de cuadrar.
 */
export async function verifyInclusion(proof: DeviceProof): Promise<boolean> {
  if (proof.index < 0) return false;
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

/**
 * Comprueba la prueba completa: el dispositivo está en el árbol y el árbol lo
 * firmó el operador.
 *
 * `expectedIdentityKey` ata la línea a la clave que se va a usar: si el
 * servidor enseña una prueba de otra línea, o de otro momento, no cuadra.
 */
export async function verifyDeviceProof(
  proof: DeviceProof,
  snapshot: KeySnapshotHeader,
  expectedIdentityKey: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (proof.root !== snapshot.merkleRoot) {
    return { ok: false, reason: "La prueba no es de la instantánea que se publicó." };
  }
  if (!proof.line.includes(`|${expectedIdentityKey}|`)) {
    return { ok: false, reason: "La prueba es de otro dispositivo." };
  }
  if (!(await verifyInclusion(proof))) {
    return { ok: false, reason: "La prueba no llega a la raíz firmada." };
  }
  if (!(await verifySnapshotSignature(snapshot))) {
    return { ok: false, reason: "La instantánea no está firmada por su clave." };
  }
  return { ok: true };
}
