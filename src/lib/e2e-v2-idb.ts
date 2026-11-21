/**
 * Guardado del dispositivo v2 en el navegador.
 *
 * Lo que se guarda es el bote (`pickle`) de libolm y las sesiones del ratchet,
 * **cifrados con AES-GCM** y con una clave que se guarda como `CryptoKey` no
 * extraíble en IndexedDB: ni el JavaScript de la página ni el servidor pueden
 * sacarla. Es la misma idea que la identidad de v1 y la razón es la misma: si
 * esto se pierde, los mensajes de ese dispositivo ya no se leen.
 *
 * El registro guarda `{ iv, data }`, nunca el estado en claro: IndexedDB acaba
 * en un perfil de navegador que se copia y que un XSS puede leer.
 */
import type { DeviceState, DeviceStore } from "./e2e-v2-device";

const DB_NAME = "wanderbibliothek-e2e";
/** v1 abrió la base en la versión 1 con el almacén `identity`. */
const DB_VERSION = 2;
const DEVICE_STORE = "device-v2";
const KEY_STORE = "device-key-v2";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB falló."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      // Solo se crean los que falten: la base la comparte la identidad de v1.
      if (!db.objectStoreNames.contains(DEVICE_STORE)) db.createObjectStore(DEVICE_STORE);
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

/** Clave local de cifrado: aleatoria, no exportable y guardada en IndexedDB. */
async function localKey(db: IDBDatabase): Promise<CryptoKey> {
  const store = db.transaction(KEY_STORE, "readwrite").objectStore(KEY_STORE);
  const existing = (await request(store.get("local"))) as CryptoKey | undefined;
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await request(store.put(key, "local"));
  return key;
}

export function isSupported(): boolean {
  return typeof globalThis.indexedDB !== "undefined" && Boolean(globalThis.crypto?.subtle);
}

/**
 * Almacén real. Si el navegador no tiene IndexedDB o WebCrypto, el módulo no se
 * usa: el llamador tiene que decir que el cifrado no está disponible en vez de
 * fingir que sí.
 */
export function indexedDbStore(): DeviceStore {
  let db: Promise<IDBDatabase> | null = null;
  const database = () => (db ??= openDatabase());

  return {
    async load(userId: string): Promise<DeviceState | null> {
      const connection = await database();
      const key = await localKey(connection);
      const record = (await request(
        connection.transaction(DEVICE_STORE, "readonly").objectStore(DEVICE_STORE).get(userId),
      )) as { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer } | undefined;
      if (!record) return null;
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, key, record.data);
      return JSON.parse(new TextDecoder().decode(plain)) as DeviceState;
    },

    async save(state: DeviceState): Promise<void> {
      const connection = await database();
      const key = await localKey(connection);
      const iv = crypto.getRandomValues(new Uint8Array(12) as Uint8Array<ArrayBuffer>);
      const data = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(JSON.stringify(state)),
      );
      await request(
        connection
          .transaction(DEVICE_STORE, "readwrite")
          .objectStore(DEVICE_STORE)
          .put({ iv, data }, state.userId),
      );
    },
  };
}

/** Borra el dispositivo de esta cuenta de este navegador. */
export async function forgetDevice(userId: string): Promise<void> {
  const connection = await openDatabase();
  await request(
    connection.transaction(DEVICE_STORE, "readwrite").objectStore(DEVICE_STORE).delete(userId),
  );
}
