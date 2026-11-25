/**
 * Transparencia del catálogo público.
 *
 * La instancia publica periódicamente una **instantánea firmada** del catálogo
 * público: una línea JSON canónica por obra (título, autoría, ediciones y
 * ciudades con ejemplares), su hash, la raíz de un árbol de Merkle y la firma
 * Ed25519 del conjunto. Cualquiera puede descargar la instantánea, recalcular
 * esos valores y comprobar que la firma es de esta instancia.
 *
 * Qué garantiza y qué no:
 *
 * - Detecta que el contenido público cambió **sin dejar rastro**: si alguien
 *   reescribe una instantánea publicada, la firma o la raíz dejan de cuadrar.
 * - No prueba qué código se ejecuta en el servidor. Eso lo cubren la imagen
 *   firmada de la release y `/api/version`.
 * - No incluye nada de personas: el origen es `listPublicWorks()`, que ya
 *   publica la obra y cifras agregadas, nunca quién tiene cada ejemplar. Por
 *   eso la instantánea se puede servir sin sesión y sin recortar nada.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { getDb, type Db } from "./db";
import { KEY_MESSAGE_VERSION as KEY_FORMAT_VERSION } from "./e2e-v2-format";
import { deviceDirectoryLine, slotDirectoryLine } from "./key-directory-format";

export {
  deviceDirectoryLine,
  revokedSlotDirectoryLine,
  slotDirectoryLine,
} from "./key-directory-format";
import { listPublicWorks } from "./repo";

/** Cabecera del mensaje firmado: si cambia el formato, sube la versión. */
const MESSAGE_VERSION = "wanderbibliothek-transparency-v1";
/** Días que se conserva el contenido descargable de cada instantánea. */
export const PAYLOAD_RETENTION_DAYS = 400;

export type TransparencySnapshot = {
  id: string;
  createdAt: string;
  itemCount: number;
  merkleRoot: string;
  payloadHash: string;
  /** Raíz de la instantánea anterior: enlaza unas con otras. */
  previousRoot: string | null;
  /** Firma Ed25519 en base64, o `null` si la instancia no tiene clave. */
  signature: string | null;
  /** Clave pública Ed25519 (SPKI en base64) con la que se firmó. */
  publicKey: string | null;
  signer: string | null;
};

type SnapshotRow = {
  id: string;
  created_at: string;
  item_count: number;
  merkle_root: string;
  payload_hash: string;
  previous_root: string | null;
  signature: string | null;
  public_key: string | null;
  signer: string | null;
};

export type TransparencyKey = { privateKey: KeyObject; publicKey: string };

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * JSON con las claves ordenadas y sin espacios.
 *
 * `JSON.stringify` respeta el orden de inserción: dos objetos iguales podrían
 * producir bytes distintos y romper la comparación de hashes. Aquí el orden es
 * el alfabético, así que la misma instantánea siempre se serializa igual.
 */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  const json = JSON.stringify(value);
  return json === undefined ? "null" : json;
}

function leafHash(line: string): string {
  return sha256(`leaf:${line}`);
}

function nodeHash(left: string, right: string): string {
  return sha256(`node:${left}${right}`);
}

/**
 * Raíz de Merkle de las líneas, en el orden recibido.
 *
 * Los nodos impares se promueven tal cual al siguiente nivel (el criterio de
 * Bitcoin): el verificador externo tiene que usar exactamente la misma regla.
 */
export function merkleRoot(lines: string[]): string {
  if (lines.length === 0) return sha256("");
  let level = lines.map(leafHash);
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1];
      next.push(right === undefined ? left : nodeHash(left, right));
    }
    level = next;
  }
  return level[0]!;
}

/**
 * Mayor potencia de dos **estrictamente menor** que n (la regla de RFC 6962).
 */
function powerBelow(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function consistencySubproof(m: number, lines: string[], complete: boolean): string[] {
  const n = lines.length;
  if (m === n) return complete ? [] : [merkleRoot(lines)];
  const k = powerBelow(n);
  if (m <= k) {
    return [...consistencySubproof(m, lines.slice(0, k), complete), merkleRoot(lines.slice(k))];
  }
  return [...consistencySubproof(m - k, lines.slice(k), false), merkleRoot(lines.slice(0, k))];
}

/**
 * Prueba de que el árbol nuevo **contiene** al viejo (RFC 6962, `SUBPROOF`).
 *
 * Es lo que convierte «esta raíz la firma el operador» en «esta raíz es la
 * continuación de la que vi»: sin ella, el operador puede firmar dos historias
 * coherentes y las dos verifican. Devuelve `null` si el árbol nuevo no empieza
 * por las mismas hojas (no hay nada que demostrar) y `[]` si no hay árbol viejo.
 *
 * Exige que las líneas viejas sean un **prefijo** de las nuevas: por eso el
 * directorio es un registro append-only (`key_directory_log`).
 */
export function merkleConsistencyProof(
  oldLines: string[],
  newLines: string[],
): string[] | null {
  if (oldLines.length > newLines.length) return null;
  for (let index = 0; index < oldLines.length; index += 1) {
    if (newLines[index] !== oldLines[index]) return null;
  }
  if (oldLines.length === 0) return [];
  return consistencySubproof(oldLines.length, newLines, true);
}

/** Lo que necesita quien verifica: las dos cabeceras y los hashes del camino. */
export type KeyConsistencyProof = {
  from: { id: string; itemCount: number; merkleRoot: string; createdAt: string };
  to: { id: string; itemCount: number; merkleRoot: string; createdAt: string };
  proof: string[];
};

/**
 * Caché de las líneas de las últimas instantáneas.
 *
 * Las instantáneas son inmutables y `keyInclusion` las descomprime en cada
 * petición. Sin caché, pedir la prueba de un dispositivo cuesta O(n) en cada
 * mensaje nuevo y el directorio solo crece. Se guardan las últimas veinte, la
 * misma ventana que publica la API.
 */
const snapshotLineCache = new Map<string, string[]>();

function linesForSnapshot(id: string, payload: Buffer | null): string[] | null {
  if (!payload) return null;
  const cached = snapshotLineCache.get(id);
  if (cached) return cached;
  const lines = gunzipSync(payload).toString("utf8").split("\n").filter(Boolean);
  if (snapshotLineCache.size >= 20) {
    const oldest = snapshotLineCache.keys().next().value;
    if (oldest) snapshotLineCache.delete(oldest);
  }
  snapshotLineCache.set(id, lines);
  return lines;
}

/**
 * Prueba de consistencia entre dos instantáneas guardadas del directorio.
 *
 * Solo necesita los dos `payload` que ya están en la base (se conservan siempre:
 * de ellos sale la prueba exacta de lo que se firmó).
 */
export function consistencyProofBetween(
  fromId: string,
  toId: string,
  db: Db = getDb(),
): KeyConsistencyProof | null {
  const read = (id: string) => {
    const row = db
      .prepare(
        `SELECT id, item_count, merkle_root, created_at, payload FROM key_snapshots WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          item_count: number;
          merkle_root: string;
          created_at: string;
          payload: Buffer | null;
        }
      | undefined;
    if (!row?.payload) return null;
    const lines = linesForSnapshot(row.id, row.payload);
    if (!lines) return null;
    return {
      header: {
        id: row.id,
        itemCount: row.item_count,
        merkleRoot: row.merkle_root,
        createdAt: row.created_at,
      },
      lines,
    };
  };
  const from = read(fromId);
  const to = read(toId);
  if (!from || !to) return null;
  const proof = merkleConsistencyProof(from.lines, to.lines);
  if (!proof) return null;
  return { from: from.header, to: to.header, proof };
}

/**
 * Líneas canónicas del catálogo público.
 *
 * Se ordenan por su propio texto: el orden de `listPublicWorks` depende de
 * cuántos ejemplares hay y cambiaría la raíz por un motivo que no es un cambio
 * de contenido. Se recortan los campos que no aportan (portada, que apunta a un
 * tercero) y se quedan los que describen la obra y su disponibilidad.
 */
export function catalogLines(): string[] {
  return listPublicWorks()
    .map((work) =>
      stableJson({
        id: work.id,
        title: work.title,
        author: work.author,
        category: work.category,
        language: work.language,
        isbn: work.isbn,
        publisher: work.publisher,
        year: work.year,
        series: work.series,
        pages: work.pages,
        copies: work.copies,
        cities: work.cities,
      }),
    )
    .sort();
}

/** Texto NDJSON que se firma y se descarga; acaba en salto de línea. */
export function payloadOf(lines: string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

export function payloadHash(payload: string): string {
  return sha256(payload);
}

/** Cuerpo exacto que firma Ed25519: una línea por campo, sin ambigüedad. */
export function snapshotMessage(
  snapshot: Pick<
    TransparencySnapshot,
    "id" | "createdAt" | "itemCount" | "merkleRoot" | "payloadHash" | "previousRoot"
  >,
): string {
  return [
    MESSAGE_VERSION,
    snapshot.id,
    snapshot.createdAt,
    String(snapshot.itemCount),
    snapshot.merkleRoot,
    snapshot.payloadHash,
    snapshot.previousRoot ?? "",
  ].join("\n");
}

/**
 * Clave de firma de la instancia.
 *
 * Acepta PEM o PKCS#8 en base64. Si falta o no es Ed25519 se devuelve `null`:
 * la instancia sigue publicando instantáneas, pero avisa de que no están
 * firmadas. Nunca se inventa una clave efímera: una firma que cambia en cada
 * arranque no serviría para nada.
 */
export function signingKey(raw: string | undefined = process.env.TRANSPARENCY_SIGNING_KEY): TransparencyKey | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const privateKey = value.includes("BEGIN")
      ? createPrivateKey(value)
      : createPrivateKey({
          key: Buffer.from(value, "base64"),
          format: "der",
          type: "pkcs8",
        });
    if (privateKey.asymmetricKeyType !== "ed25519") return null;
    const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    return { privateKey, publicKey: Buffer.from(spki).toString("base64") };
  } catch {
    return null;
  }
}

export function verifySignature(
  snapshot: TransparencySnapshot,
  publicKey = snapshot.publicKey,
): boolean {
  if (!snapshot.signature || !publicKey) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(snapshotMessage(snapshot)),
      key,
      Buffer.from(snapshot.signature, "base64"),
    );
  } catch {
    return false;
  }
}

/** Huella SHA-256 de la clave SPKI, para fijarla fuera de banda. */
export function publicKeyFingerprint(publicKey: string): string | null {
  try {
    const der = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    }).export({ format: "der", type: "spki" });
    return createHash("sha256").update(der).digest("hex");
  } catch {
    return null;
  }
}

function toSnapshot(row: SnapshotRow): TransparencySnapshot {
  return {
    id: row.id,
    createdAt: row.created_at,
    itemCount: row.item_count,
    merkleRoot: row.merkle_root,
    payloadHash: row.payload_hash,
    previousRoot: row.previous_root,
    signature: row.signature,
    publicKey: row.public_key,
    signer: row.signer,
  };
}

const SELECT_COLUMNS = `id, created_at, item_count, merkle_root, payload_hash,
  previous_root, signature, public_key, signer`;

export function latestSnapshot(db: Db = getDb()): TransparencySnapshot | null {
  const row = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM transparency_snapshots
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get() as SnapshotRow | undefined;
  return row ? toSnapshot(row) : null;
}

export function listSnapshots(limit = 20, db: Db = getDb()): TransparencySnapshot[] {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM transparency_snapshots
        ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.min(200, limit))) as SnapshotRow[];
  return rows.map(toSnapshot);
}

export type CreateSnapshotOptions = {
  /** Para pruebas y para fijar la hora desde el cron. */
  now?: string;
  /** Clave de firma; `undefined` la toma del entorno, `null` no firma. */
  key?: TransparencyKey | null;
  /** Líneas ya construidas; sin esto se lee el catálogo público. */
  lines?: string[];
};

/**
 * Crea y guarda una instantánea. Devuelve la fila pública (sin el contenido).
 *
 * El contenido se guarda comprimido para que la descarga posterior sea la
 * prueba exacta de lo que se firmó. Las instantáneas son inmutables: la API
 * nunca las modifica y la única escritura posterior es borrar el contenido
 * antiguo por retención, que no afecta a raíces ni firmas.
 */
export function createSnapshot(
  db: Db = getDb(),
  options: CreateSnapshotOptions = {},
): TransparencySnapshot {
  const createdAt = options.now ?? new Date().toISOString();
  const lines = options.lines ?? catalogLines();
  const payload = payloadOf(lines);
  const previous = latestSnapshot(db);
  const key = options.key === undefined ? signingKey() : options.key;

  const snapshot: TransparencySnapshot = {
    id: `snp_${randomUUID()}`,
    createdAt,
    itemCount: lines.length,
    merkleRoot: merkleRoot(lines),
    payloadHash: payloadHash(payload),
    previousRoot: previous?.merkleRoot ?? null,
    signature: null,
    publicKey: key?.publicKey ?? null,
    signer: key ? "ed25519" : null,
  };

  if (key) {
    snapshot.signature = sign(
      null,
      Buffer.from(snapshotMessage(snapshot)),
      key.privateKey,
    ).toString("base64");
  }

  db.prepare(
    `INSERT INTO transparency_snapshots
       (id, created_at, item_count, merkle_root, payload_hash, previous_root,
        payload, signature, public_key, signer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    snapshot.id,
    snapshot.createdAt,
    snapshot.itemCount,
    snapshot.merkleRoot,
    snapshot.payloadHash,
    snapshot.previousRoot,
    gzipSync(Buffer.from(payload, "utf8")),
    snapshot.signature,
    snapshot.publicKey,
    snapshot.signer,
  );

  prunePayloads(db, createdAt);
  return snapshot;
}

/**
 * Una instantánea al día como mucho: el cron pasa cada quince minutos y no
 * tiene sentido firmar el mismo catálogo cuatro veces por hora.
 */
export function ensureDailySnapshot(
  db: Db = getDb(),
  options: CreateSnapshotOptions = {},
): TransparencySnapshot | null {
  const now = options.now ?? new Date().toISOString();
  const latest = latestSnapshot(db);
  if (latest && latest.createdAt.slice(0, 10) === now.slice(0, 10)) return null;
  return createSnapshot(db, { ...options, now });
}

/** Contenido exacto de una instantánea, o `null` si no existe o ya se podó. */
export function readPayload(
  id: string,
  db: Db = getDb(),
): { snapshot: TransparencySnapshot; payload: string | null } | null {
  const row = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}, payload FROM transparency_snapshots WHERE id = ?`,
    )
    .get(id) as (SnapshotRow & { payload: Buffer | null }) | undefined;
  if (!row) return null;
  return {
    snapshot: toSnapshot(row),
    payload: row.payload ? gunzipSync(row.payload).toString("utf8") : null,
  };
}

/**
 * Borra el contenido descargable antiguo, no la instantánea.
 *
 * Pasado el plazo de retención, una copia del catálogo deja de ser útil y sí es
 * un histórico innecesario. La raíz, el hash y la firma se conservan: la cadena
 * sigue siendo verificable y nadie puede reescribir lo publicado.
 */
export function prunePayloads(
  db: Db,
  now: string,
  retentionDays = PAYLOAD_RETENTION_DAYS,
): number {
  const cutoff = new Date(Date.parse(now) - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare(
      "UPDATE transparency_snapshots SET payload = NULL WHERE payload IS NOT NULL AND created_at < ?",
    )
    .run(cutoff).changes;
}

/**
 * Comprueba que la lista (de más nueva a más antigua) no tiene eslabones
 * rotos: la raíz anterior que declara cada instantánea tiene que ser la raíz de
 * la siguiente. Así una instantánea intermedia no se puede sustituir por otra
 * sin que la cadena deje de cuadrar.
 */
export function verifyChain(snapshots: TransparencySnapshot[]): SnapshotVerification {
  const problems: string[] = [];
  for (let index = 0; index + 1 < snapshots.length; index += 1) {
    const newer = snapshots[index]!;
    const older = snapshots[index + 1]!;
    if (newer.previousRoot !== older.merkleRoot) {
      problems.push(
        `${newer.id} dice venir de ${newer.previousRoot ?? "nada"} y la anterior es ${older.merkleRoot}`,
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

export type SnapshotVerification = { ok: boolean; problems: string[] };

/**
 * Comprueba una instantánea contra el contenido descargado.
 *
 * Es la misma lógica que ejecuta `scripts/verify-transparency.ts`, para que
 * quien audite desde fuera no dependa de la ruta HTTP: con el JSON de la API y
 * el NDJSON descargado basta.
 */
export function verifySnapshot(
  snapshot: TransparencySnapshot,
  payload: string | null,
  pinned: { publicKey?: string; keyFingerprint?: string } = {},
): SnapshotVerification {
  const problems: string[] = [];
  if (payload === null) {
    problems.push("la instantánea ya no conserva el contenido descargable");
    return { ok: false, problems };
  }

  if (payloadHash(payload) !== snapshot.payloadHash) {
    problems.push("el hash del contenido no coincide con el publicado");
  }

  const lines = payload === "" ? [] : payload.replace(/\n$/, "").split("\n");
  if (lines.length !== snapshot.itemCount) {
    problems.push(
      `el contenido tiene ${lines.length} obras y la instantánea anuncia ${snapshot.itemCount}`,
    );
  }
  if (merkleRoot(lines) !== snapshot.merkleRoot) {
    problems.push("la raíz de Merkle no coincide con el contenido");
  }
  if (!snapshot.signature || !snapshot.publicKey) {
    problems.push("la instantánea no está firmada: esta instancia no publica una prueba criptográfica");
  } else {
    const pinKey = pinned.publicKey?.trim() || null;
    const pinFingerprint = pinned.keyFingerprint?.trim().toLowerCase() || null;
    if (pinKey && snapshot.publicKey !== pinKey) {
      problems.push("la clave pública de la instantánea no coincide con la clave fijada");
    }
    if (
      pinFingerprint &&
      publicKeyFingerprint(snapshot.publicKey) !== pinFingerprint
    ) {
      problems.push("la huella de la clave pública no coincide con la fijada");
    }
    // Si hay una clave fijada, la firma se comprueba contra ella; si no, contra
    // la que trae la instantánea. La huella sola no basta para verificar.
    const keyToUse = pinKey ?? snapshot.publicKey;
    if (!pinKey || snapshot.publicKey === pinKey) {
      if (!verifySignature(snapshot, keyToUse)) {
        problems.push("la firma Ed25519 no valida con la clave publicada");
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

/* ------------------------- directorio de claves ---------------------------- */

/**
 * Instantánea firmada del directorio de claves.
 *
 * No publica qué clave tiene cada cuenta: guarda la raíz de Merkle y su firma,
 * y cada cuenta puede pedir su **prueba de inclusión** (`keyInclusion`). Esa
 * prueba demuestra que la clave que el servidor le enseña está en el conjunto
 * comprometido; si el servidor quisiera enseñarle otra, no podría fabricar la
 * prueba contra una raíz firmada.
 */
export type KeySnapshot = {
  id: string;
  createdAt: string;
  itemCount: number;
  merkleRoot: string;
  previousRoot: string | null;
  signature: string | null;
  publicKey: string | null;
  signer: string | null;
};

type KeySnapshotRow = {
  id: string;
  created_at: string;
  item_count: number;
  merkle_root: string;
  previous_root: string | null;
  signature: string | null;
  public_key: string | null;
  signer: string | null;
};

const KEY_COLUMNS = `id, created_at, item_count, merkle_root, previous_root,
  signature, public_key, signer`;

/** Cabecera del mensaje firmado del directorio; si cambia, sube la versión. */
// La versión del mensaje firmado vive en `e2e-v2-format.ts` para que el cliente
// pueda reconstruirlo al verificar la firma sin cargar este módulo (que usa
// `node:crypto`).
const KEY_MESSAGE_VERSION = KEY_FORMAT_VERSION;

function toKeySnapshot(row: KeySnapshotRow): KeySnapshot {
  return {
    id: row.id,
    createdAt: row.created_at,
    itemCount: row.item_count,
    merkleRoot: row.merkle_root,
    previousRoot: row.previous_root,
    signature: row.signature,
    publicKey: row.public_key,
    signer: row.signer,
  };
}

/**
 * Líneas canónicas del directorio: una por clave publicada.
 *
 * Llevan la cuenta, la ranura, la huella y la fecha de alta; **no** la clave
 * pública, que ya viaja en `user_keys` y haría el fichero enorme. El orden es
 * por cuenta y ranura, que es estable.
 *
 * Desde el protocolo v2 entran también los **dispositivos**: sin ellos, un
 * servidor hostil podría añadir un dispositivo a una cuenta y quedar en medio
 * de todas las conversaciones sin que nada lo delatara, porque la clave de un
 * dispositivo no estaba comprometida en ningún sitio. La ranura de un
 * dispositivo es `device:<id>` y su hoja lleva la clave de identidad y la de
 * firma: las dos quedan atadas al mismo compromiso.
 */
export function keyDirectoryLines(db: Db = getDb()): string[] {
  const rows = db
    .prepare("SELECT line FROM key_directory_log ORDER BY seq")
    .all() as { line: string }[];
  return rows.map((row) => row.line);
}

/** Última línea apuntada para una ranura, o `null` si nunca se apuntó. */
export function lastDirectoryLine(
  userId: string,
  slot: string,
  db: Db = getDb(),
): string | null {
  const row = db
    .prepare(
      `SELECT line FROM key_directory_log WHERE user_id = ? AND slot = ?
        ORDER BY seq DESC LIMIT 1`,
    )
    .get(userId, slot) as { line: string } | undefined;
  return row?.line ?? null;
}

/**
 * Apunta un cambio de un dispositivo en el registro del directorio.
 *
 * El registro es **append-only** y de ahí sale la lista que se firma: si las
 * hojas se reescribieran en su sitio, el árbol nuevo no sería una extensión del
 * anterior y no existiría prueba de consistencia posible (las pruebas de
 * consistencia de Merkle exigen que lo publicado solo crezca por el final).
 *
 * Solo se apunta cuando cambia algo que importa —la identidad o la retirada—:
 * reponer claves de un solo uso toca `updated_at` pero no el directorio, y
 * apuntarlo haría crecer el árbol sin decir nada nuevo.
 */
export function recordDeviceInDirectory(
  db: Db,
  input: {
    userId: string;
    deviceId: string;
    identityKey: string;
    signingKey: string;
    revokedAt: string | null;
    at: string;
  },
): boolean {
  const slot = `device:${input.deviceId}`;
  const last = lastDirectoryLine(input.userId, slot, db);
  if (last) {
    const fields = last.split("|");
    const identityKey = fields[2];
    const signingKey = fields[3];
    const revoked = fields[5];
    if (
      identityKey === input.identityKey &&
      signingKey === input.signingKey &&
      revoked === `revoked:${input.revokedAt ?? "-"}`
    ) {
      return false;
    }
  }
  db.prepare(
    "INSERT INTO key_directory_log (user_id, slot, line, created_at) VALUES (?, ?, ?, ?)",
  ).run(
    input.userId,
    slot,
    deviceDirectoryLine({ ...input, updatedAt: input.at }),
    input.at,
  );
  return true;
}

/** Apunta una ranura de v1 (alta o rotación). */
export function recordSlotInDirectory(
  db: Db,
  input: { userId: string; platform: string; keyId: string; at: string },
): void {
  const line = slotDirectoryLine({
    userId: input.userId,
    platform: input.platform,
    keyId: input.keyId,
    updatedAt: input.at,
  });
  if (lastDirectoryLine(input.userId, input.platform, db) === line) return;
  db.prepare(
    "INSERT INTO key_directory_log (user_id, slot, line, created_at) VALUES (?, ?, ?, ?)",
  ).run(input.userId, input.platform, line, input.at);
}

export function keySnapshotMessage(
  snapshot: Pick<KeySnapshot, "id" | "createdAt" | "itemCount" | "merkleRoot" | "previousRoot">,
): string {
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
 * Rama de Merkle de una hoja concreta.
 *
 * Los niveles impares se promueven sin hermano, igual que en `merkleRoot`: la
 * rama omite esos pasos y el verificador avanza con la paridad del índice.
 */
export type MerkleStep = { hash: string; side: "left" | "right" };

export function merkleBranch(lines: string[], index: number): MerkleStep[] {
  if (index < 0 || index >= lines.length) return [];
  let level = lines.map(leafHash);
  let position = index;
  const branch: MerkleStep[] = [];
  while (level.length > 1) {
    const sibling = position % 2 === 0 ? position + 1 : position - 1;
    // Cuando el nodo es el último de un nivel impar se promueve sin hermano:
    // no se añade paso y la combinación ocurre en el nivel siguiente.
    if (sibling >= 0 && sibling < level.length) {
      branch.push({ hash: level[sibling]!, side: position % 2 === 0 ? "right" : "left" });
    }
    const next: string[] = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      const left = level[cursor]!;
      const right = level[cursor + 1];
      next.push(right === undefined ? left : nodeHash(left, right));
    }
    level = next;
    position = Math.floor(position / 2);
  }
  return branch;
}

export function verifyMerkleBranch(
  line: string,
  index: number,
  branch: MerkleStep[],
  root: string,
): boolean {
  if (index < 0) return false;
  let hash = leafHash(line);
  for (const step of branch) {
    hash = step.side === "left" ? nodeHash(step.hash, hash) : nodeHash(hash, step.hash);
  }
  return hash === root;
}

export function latestKeySnapshot(db: Db = getDb()): KeySnapshot | null {
  // Manda el orden de inserción (`rowid`), no el id ni la fecha: los ids son
  // aleatorios —así que con dos instantáneas en el mismo milisegundo «la
  // última» era cualquiera de las dos— y la fecha puede venir del llamador, de
  // modo que una instantánea con hora futura se quedaba como la última para
  // siempre y las siguientes no se veían. La cadena de `previousRoot` se
  // escribe en orden de inserción: es la misma vara con la que se lee.
  const row = db
    .prepare(`SELECT ${KEY_COLUMNS} FROM key_snapshots ORDER BY rowid DESC LIMIT 1`)
    .get() as KeySnapshotRow | undefined;
  return row ? toKeySnapshot(row) : null;
}

export function listKeySnapshots(limit = 20, db: Db = getDb()): KeySnapshot[] {
  // El mismo criterio que `latestKeySnapshot`: la lista tiene que empezar por la
  // instantánea con la que se responden las pruebas de inclusión, no por la que
  // tenga la fecha más alta.
  const rows = db
    .prepare(`SELECT ${KEY_COLUMNS} FROM key_snapshots ORDER BY rowid DESC LIMIT ?`)
    .all(Math.max(1, Math.min(200, limit))) as KeySnapshotRow[];
  return rows.map(toKeySnapshot);
}

export type CreateKeySnapshotOptions = {
  now?: string;
  key?: TransparencyKey | null;
  lines?: string[];
};

export function createKeySnapshot(
  db: Db = getDb(),
  options: CreateKeySnapshotOptions = {},
): KeySnapshot {
  // Leer `previous` y escribir la nueva instantánea tienen que ser una sola
  // unidad. Sin transacción, dos procesos podían encadenar la misma anterior y
  // dejar dos raíces que no se contienen: la prueba de consistencia deja de
  // existir para una de las dos.
  const create = (): KeySnapshot => {
    const createdAt = options.now ?? new Date().toISOString();
    const lines = options.lines ?? keyDirectoryLines(db);
    const previous = latestKeySnapshot(db);
    const key = options.key === undefined ? signingKey() : options.key;

    const snapshot: KeySnapshot = {
      id: `kys_${randomUUID()}`,
      createdAt,
      itemCount: lines.length,
      merkleRoot: merkleRoot(lines),
      previousRoot: previous?.merkleRoot ?? null,
      signature: null,
      publicKey: key?.publicKey ?? null,
      signer: key ? "ed25519" : null,
    };
    if (key) {
      snapshot.signature = sign(
        null,
        Buffer.from(keySnapshotMessage(snapshot)),
        key.privateKey,
      ).toString("base64");
    }

    db.prepare(
      `INSERT INTO key_snapshots
         (id, created_at, item_count, merkle_root, previous_root, payload,
          signature, public_key, signer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      snapshot.id,
      snapshot.createdAt,
      snapshot.itemCount,
      snapshot.merkleRoot,
      snapshot.previousRoot,
      gzipSync(Buffer.from(lines.join("\n"), "utf8")),
      snapshot.signature,
      snapshot.publicKey,
      snapshot.signer,
    );
    return snapshot;
  };
  return db.inTransaction ? create() : db.transaction(create)();
}

/** Una al día como mucho, igual que el catálogo. */
export function ensureDailyKeySnapshot(
  db: Db = getDb(),
  options: CreateKeySnapshotOptions = {},
): KeySnapshot | null {
  const now = options.now ?? new Date().toISOString();
  const latest = latestKeySnapshot(db);
  if (latest && latest.createdAt.slice(0, 10) === now.slice(0, 10)) return null;
  return createKeySnapshot(db, { ...options, now });
}

/**
 * Deja el dispositivo recién publicado dentro de una instantánea firmada.
 *
 * La prueba de inclusión se calcula contra la **última** instantánea y esas se
 * crean una vez al día. Sin esto, activar v2 dejaba al dispositivo sin prueba
 * hasta el día siguiente: el cliente no podía comprobar el directorio, caía a
 * v1, y donde las dos partes tenían dispositivo el servidor rechazaba el envío
 * (regla anti-degradación). Se firma con la clave del operador, si la hay.
 */
export function ensureKeySnapshotForDevice(
  userId: string,
  deviceId: string,
  db: Db = getDb(),
): string | null {
  // La comprobación no puede ser «existe alguna prueba de esta ranura»: tras
  // cambiar la identidad, reactivar o retirar, la instantánea anterior sigue
  // teniendo una línea (la vieja). Lo que importa es que la última línea del
  // registro —el estado actual— esté dentro de la instantánea más reciente.
  const current = lastDirectoryLine(userId, `device:${deviceId}`, db);
  if (!current) return null;
  const proof = keyInclusion(userId, `device:${deviceId}`, db);
  if (proof?.line === current) return null;
  return createKeySnapshot(db).id;
}

export type KeyInclusionProof = {
  snapshotId: string;
  root: string;
  line: string;
  index: number;
  branch: MerkleStep[];
  signature: string | null;
  publicKey: string | null;
};

/**
 * Prueba de que la clave publicada de una cuenta está en la última instantánea.
 *
 * Devuelve `null` si la cuenta no tiene clave o si todavía no hay instantánea.
 */
export function keyInclusion(
  userId: string,
  platform = "web",
  db: Db = getDb(),
): KeyInclusionProof | null {
  const snapshot = latestKeySnapshot(db);
  if (!snapshot) return null;
  const row = db
    .prepare("SELECT payload FROM key_snapshots WHERE id = ?")
    .get(snapshot.id) as { payload: Buffer | null } | undefined;
  const lines = linesForSnapshot(snapshot.id, row?.payload ?? null);
  if (!lines) return null;
  const prefix = `${userId}|${platform}|`;
  // La **última**: el registro es un histórico y la ranura puede aparecer varias
  // veces (una por rotación, cambio de identidad o retirada); la que vale es la
  // más reciente.
  let index = -1;
  for (let cursor = lines.length - 1; cursor >= 0; cursor -= 1) {
    if (lines[cursor]!.startsWith(prefix)) {
      index = cursor;
      break;
    }
  }
  if (index < 0) return null;
  return {
    snapshotId: snapshot.id,
    root: snapshot.merkleRoot,
    line: lines[index]!,
    index,
    branch: merkleBranch(lines, index),
    signature: snapshot.signature,
    publicKey: snapshot.publicKey,
  };
}

/** Comprueba la firma de una instantánea del directorio. */
export function verifyKeySnapshotSignature(
  snapshot: KeySnapshot,
  publicKey = snapshot.publicKey,
): boolean {
  if (!snapshot.signature || !publicKey) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(keySnapshotMessage(snapshot)),
      key,
      Buffer.from(snapshot.signature, "base64"),
    );
  } catch {
    return false;
  }
}

/** La cadena del directorio se comprueba igual que la del catálogo. */
export function verifyKeyChain(snapshots: KeySnapshot[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    const newer = snapshots[index - 1]!;
    const older = snapshots[index]!;
    if (newer.previousRoot !== older.merkleRoot) {
      problems.push(
        `${newer.id} dice venir de ${newer.previousRoot ?? "nada"} y la anterior es ${older.merkleRoot}`,
      );
    }
  }
  return { ok: problems.length === 0, problems };
}
