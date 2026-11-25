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

async function nodeHash(left: string, right: string): Promise<string> {
  return sha256(`node:${left}${right}`);
}

/**
 * Comprueba que el árbol nuevo **contiene** al viejo (RFC 6962).
 *
 * Con esto, un cliente que ya vio una raíz no puede recibir una historia
 * alternativa: la prueba fallaría y fabricarla exigiría una colisión de SHA-256.
 * Se verifica aquí, en el cliente, con la misma regla de nodos que usa el
 * servidor para construir; que las dos implementaciones coincidan lo comprueban
 * las pruebas, no la fe.
 */
export async function verifyConsistencyProof(
  oldSize: number,
  oldRoot: string,
  newSize: number,
  newRoot: string,
  proof: string[],
): Promise<boolean> {
  if (!Number.isSafeInteger(oldSize) || !Number.isSafeInteger(newSize)) return false;
  if (oldSize < 0 || newSize < oldSize) return false;
  if (!HASH.test(oldRoot) || !HASH.test(newRoot)) return false;
  // El árbol vacío es prefijo de cualquiera y no hay nada que demostrar.
  if (oldSize === 0) return proof.length === 0;
  if (oldSize === newSize) return proof.length === 0 && oldRoot === newRoot;
  if (proof.length === 0 || !proof.every((hash) => HASH.test(hash))) return false;

  // Si el árbol viejo es perfecto (tamaño potencia de dos) su raíz es un nodo
  // del nuevo, y la prueba es la lista de subárboles hermanos que quedan a la
  // derecha, de abajo arriba: se combinan en orden.
  if ((oldSize & (oldSize - 1)) === 0) {
    let node = oldRoot;
    for (const hash of proof) node = await nodeHash(node, hash);
    return node === newRoot;
  }

  // Si no, se reconstruyen las dos raíces a la vez desde el primer nodo que
  // comparten (el algoritmo de RFC 6962): `first` es la raíz vieja y `second`
  // la nueva; si divergen, alguna de las dos no cuadra.
  let first = oldSize - 1;
  let second = newSize - 1;
  while (first % 2 === 1) {
    first = Math.floor(first / 2);
    second = Math.floor(second / 2);
  }

  let firstRoot = proof[0]!;
  let secondRoot = proof[0]!;
  for (let index = 1; index < proof.length; index += 1) {
    const hash = proof[index]!;
    if (second === 0) return false;
    if (first % 2 === 1 || first === second) {
      firstRoot = await nodeHash(hash, firstRoot);
      secondRoot = await nodeHash(hash, secondRoot);
      while (first !== 0 && first % 2 === 0) {
        first = Math.floor(first / 2);
        second = Math.floor(second / 2);
      }
    } else {
      secondRoot = await nodeHash(secondRoot, hash);
    }
    first = Math.floor(first / 2);
    second = Math.floor(second / 2);
  }
  return firstRoot === oldRoot && secondRoot === newRoot && second === 0;
}

/** Lo que sirve la ruta de consistencia. */
export type ConsistencyProof = {
  from: { id: string; itemCount: number; merkleRoot: string; createdAt: string };
  to: { id: string; itemCount: number; merkleRoot: string; createdAt: string };
  proof: string[];
};

/** A quién tiene que pertenecer la línea de la prueba. */
export type ExpectedDevice = {
  userId: string;
  deviceId: string;
  identityKey: string;
  signingKey: string;
};

/** Resultado de verificar una prueba: además de válida, puede estar retirada. */
export type DeviceProofResult = {
  ok: boolean;
  reason?: string;
  /** La prueba es válida y demuestra que el dispositivo está retirado. */
  revoked?: boolean;
};

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
 * `cuenta|device:<id>|<identidad>|<firma>|`, no una subcadena.
 *
 * La firma Ed25519 va en la hoja a propósito: si solo estuviera la identidad,
 * un servidor hostil podía cambiar la clave de firma en la lista de
 * dispositivos, el cliente la fijaba en el primer prekey y los envíos
 * posteriores fallaban.
 */
export async function verifyDeviceProof(
  proof: DeviceProof,
  snapshot: KeySnapshotHeader,
  expected: ExpectedDevice,
): Promise<DeviceProofResult> {
  if (proof.root !== snapshot.merkleRoot) {
    return { ok: false, reason: "La prueba no es de la instantánea que se publicó." };
  }
  const prefix = `${expected.userId}|device:${expected.deviceId}|${expected.identityKey}|${expected.signingKey}|`;
  if (!proof.line.startsWith(prefix)) {
    return { ok: false, reason: "La prueba es de otra cuenta o de otro dispositivo." };
  }
  const fields = proof.line.split("|");
  if (fields.length !== 6 || fields[2] !== expected.identityKey || fields[3] !== expected.signingKey) {
    return { ok: false, reason: "La línea del directorio no tiene el formato esperado." };
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
  // El estado de retirada se comprueba **después** de validar la prueba: una
  // prueba rota no puede servir para que el servidor se invente una retirada y
  // haga desaparecer un dispositivo activo de la lista.
  if (fields[5] !== "revoked:-") {
    return {
      ok: false,
      revoked: true,
      reason: "Ese dispositivo está retirado en el directorio.",
    };
  }
  return { ok: true };
}
