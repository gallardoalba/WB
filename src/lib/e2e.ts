/**
 * Cifrado de extremo a extremo de la mensajería.
 *
 * Diseño (deliberadamente simple y auditable):
 *
 * 1. Cada navegador genera un par ECDH P-256 la primera vez que inicia sesión.
 *    La clave privada se guarda como `CryptoKey` **no extraíble** en IndexedDB:
 *    ni el JavaScript de la página puede exportarla ni el servidor la recibe.
 * 2. La clave pública se publica en la cuenta (`PUT /api/account/keys`).
 * 3. Para cada conversación se deriva una clave AES-GCM-256 con
 *    ECDH + HKDF-SHA256 usando el identificador de la solicitud como `info`.
 *    Así dos conversaciones distintas nunca comparten clave.
 * 4. El servidor solo almacena `{ ciphertext, iv }` en base64.
 *
 * Limitación conocida: la clave vive en este dispositivo. Si se borran los
 * datos del navegador, los mensajes antiguos ya no se pueden descifrar (es el
 * precio de que nadie más pueda leerlos).
 */

const DB_NAME = "wanderbibliothek-e2e";
const STORE = "identity";
const RECORD_KEY = "identity-v1";
const HKDF_SALT = "wanderbibliothek:v1";

export type Identity = {
  version: 1;
  publicJwk: JsonWebKey;
  /** Huella SHA-256 (base64url) de la clave pública. */
  keyId: string;
  privateKey: CryptoKey;
};

export type EncryptedEnvelope = { ciphertext: string; iv: string };

export function isEncryptionSupported(): boolean {
  return (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle !== "undefined" &&
    typeof globalThis.indexedDB !== "undefined"
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir el almacén."));
  });
}

async function readRecord<T>(key: string): Promise<T | null> {
  const db = await openDatabase();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeRecord(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/** Par de claves ECDH con la privada no extraíble. */
async function generateIdentity(): Promise<Identity> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const exportedPublic = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const exportedPrivate = await crypto.subtle.exportKey("jwk", pair.privateKey);
  // Se reimporta como no extraíble: aunque alguien ejecute código en la página,
  // no puede sacar la clave privada del almacén.
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    exportedPrivate,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const publicJwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: exportedPublic.x,
    y: exportedPublic.y,
  };
  const keyId = await keyIdFromJwk(publicJwk);
  return { version: 1, publicJwk, keyId, privateKey };
}

/** Misma huella que `keyIdFromJwk` en el servidor (`src/lib/key-id.ts`). */
export async function keyIdFromJwk(
  jwk: Pick<JsonWebKey, "kty" | "crv" | "x" | "y">,
): Promise<string> {
  const canonical = `${jwk.kty}.${jwk.crv}.${jwk.x}.${jwk.y}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return bytesToBase64(new Uint8Array(digest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Texto asociado que impide mover un mensaje a otro hilo, remitente o clave. */
export function messageAad(
  requestId: string,
  senderId: string,
  keyId: string,
): string {
  return `wanderbibliothek:v1|request:${requestId}|sender:${senderId}|key:${keyId}`;
}

/**
 * Contexto autenticado de un mensaje directo: ata el sobre a esa conversación,
 * a quien lo escribe y a la clave usada, para que no se pueda reutilizar.
 */
export function directAad(
  conversationId: string,
  senderId: string,
  keyId: string,
): string {
  return `wanderbibliothek:v1|${conversationId}|sender:${senderId}|key:${keyId}`;
}

/** Identidad guardada en este navegador, si existe. */
export async function loadIdentity(): Promise<Identity | null> {
  if (!isEncryptionSupported()) return null;
  const stored = await readRecord<Identity>(RECORD_KEY);
  if (!stored || stored.version !== 1 || !stored.privateKey || !stored.publicJwk) return null;
  // Identidades creadas antes de la v16 no tenían huella: se calcula una vez.
  if (!stored.keyId) {
    stored.keyId = await keyIdFromJwk(stored.publicJwk);
    await writeRecord(RECORD_KEY, stored);
  }
  return stored;
}

/** Recupera la identidad o crea una nueva (solo la primera vez). */
export async function ensureIdentity(): Promise<Identity> {
  if (!isEncryptionSupported()) {
    throw new Error(
      "Tu navegador no permite el cifrado de extremo a extremo. Prueba con un navegador actualizado.",
    );
  }
  const existing = await loadIdentity();
  if (existing) return existing;
  const identity = await generateIdentity();
  await writeRecord(RECORD_KEY, identity);
  return identity;
}

/**
 * Clave AES-GCM de una conversación concreta. `requestId` entra en el `info`
 * de HKDF, de modo que reutilizar el mismo par de claves en dos hilos produce
 * claves distintas.
 */
export async function deriveConversationKey(
  privateKey: CryptoKey,
  peerJwk: JsonWebKey,
  requestId: string,
): Promise<CryptoKey> {
  if (peerJwk.kty !== "EC" || peerJwk.crv !== "P-256" || !peerJwk.x || !peerJwk.y) {
    throw new Error("La clave pública de la otra persona no es válida.");
  }
  const peerKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: peerJwk.x, y: peerJwk.y, ext: true },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerKey },
    privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(`wanderbibliothek:request:${requestId}`),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Cifra un texto y devuelve el sobre que se envía al servidor. */
export async function encryptMessage(
  key: CryptoKey,
  text: string,
  aad?: string,
): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      ...(aad ? { additionalData: new TextEncoder().encode(aad) } : {}),
    },
    key,
    new TextEncoder().encode(text),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

/** Descifra un sobre. Devuelve `null` si la clave no corresponde. */
export async function decryptMessage(
  key: CryptoKey,
  envelope: EncryptedEnvelope,
  aad?: string,
): Promise<string | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(envelope.iv),
        ...(aad ? { additionalData: new TextEncoder().encode(aad) } : {}),
      },
      key,
      base64ToBytes(envelope.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/* ---------------------- varias claves por destinatario ---------------------- */

/** Clave pública de un dispositivo del destinatario. */
export type RecipientKey = { keyId: string; publicJwk: JsonWebKey };
/** Sobre dirigido a una clave concreta del destinatario. */
export type MessageEnvelope = EncryptedEnvelope & { keyId: string };

type ThreadMessageLike = {
  isMine: boolean;
  keyId: string | null;
  ciphertext: string | null;
  iv: string | null;
  envelopes?: MessageEnvelope[];
};

/**
 * Sobres de un mensaje: los guardados o, en mensajes anteriores a la v40, el
 * único sobre de `ciphertext`/`iv` (sin destinatario anotado).
 */
export function envelopesOf(message: ThreadMessageLike): MessageEnvelope[] {
  if (message.envelopes && message.envelopes.length > 0) return message.envelopes;
  if (message.ciphertext && message.iv) {
    return [{ keyId: message.keyId ?? "", ciphertext: message.ciphertext, iv: message.iv }];
  }
  return [];
}

/**
 * Cifra un texto una vez por cada dispositivo del destinatario. Todos los
 * sobres comparten el mismo AAD (la clave del **remitente**), así que cualquiera
 * de los dos aparatos puede abrir el suyo.
 */
export async function encryptForRecipients(
  privateKey: CryptoKey,
  recipients: RecipientKey[],
  conversationId: string,
  text: string,
  aad: string,
): Promise<MessageEnvelope[]> {
  return Promise.all(
    recipients.map(async (recipient) => {
      const key = await deriveConversationKey(
        privateKey,
        recipient.publicJwk,
        conversationId,
      );
      const envelope = await encryptMessage(key, text, aad);
      return { keyId: recipient.keyId, ...envelope };
    }),
  );
}

/**
 * Descifra un mensaje probando el sobre que corresponde a cada clave.
 *
 * En un mensaje de la otra persona el sobre va dirigido a una clave **mía** y
 * se deriva con mi privada + la pública del remitente (`message.keyId`). En uno
 * mío los sobres van dirigidos a las claves del destinatario y se derivan con
 * mi privada + cada clave suya. Los mensajes heredados solo tienen un sobre y
 * se prueban con el primer candidato.
 */
export async function decryptForThread(
  privateKey: CryptoKey,
  myKeyId: string,
  peerKeys: RecipientKey[],
  message: ThreadMessageLike,
  senderId: string,
  conversationId: string,
  aad: (senderId: string, keyId: string) => string,
): Promise<string | null> {
  const envelopes = envelopesOf(message);
  if (envelopes.length === 0) return null;

  const senderKey = peerKeys.find((key) => key.keyId === message.keyId);
  const candidates: RecipientKey[] = [];
  if (!message.isMine && senderKey) {
    candidates.push({ keyId: myKeyId, publicJwk: senderKey.publicJwk });
  }
  candidates.push(...peerKeys);

  for (const envelope of envelopes) {
    const candidate =
      candidates.find((key) => key.keyId === envelope.keyId) ??
      (envelopes.length === 1 ? candidates[0] : undefined);
    if (!candidate) continue;
    const key = await deriveConversationKey(
      privateKey,
      candidate.publicJwk,
      conversationId,
    );
    const text = await decryptMessage(
      key,
      envelope,
      message.keyId ? aad(senderId, message.keyId) : undefined,
    );
    if (text !== null) return text;
  }
  return null;
}
