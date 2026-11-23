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

/**
 * Base **propia**, no la de v1.
 *
 * Compartir `wanderbibliothek-e2e` obligaba a subir su versión, y v1 abre la
 * suya con la versión 1: en cuanto esta la hubiera actualizado, la identidad de
 * v1 dejaba de abrirse (`VersionError`) y la conversación se quedaba muda. Dos
 * bases separadas no se pisan.
 */
const DB_NAME = "wanderbibliothek-e2e-v2";
const DB_VERSION = 1;
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
      if (!db.objectStoreNames.contains(DEVICE_STORE)) db.createObjectStore(DEVICE_STORE);
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

/** Lee la clave local, si ya existe. */
async function readLocalKey(db: IDBDatabase): Promise<CryptoKey | undefined> {
  return (await request(
    db.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE).get("local"),
  )) as CryptoKey | undefined;
}

/**
 * Clave local de cifrado: aleatoria, no exportable y guardada en IndexedDB.
 *
 * La creación es **atómica**: dos pestañas que abren el dispositivo a la vez
 * pueden no encontrar la clave y generar una cada una; la segunda vuelve a leer
 * dentro de la misma transacción de escritura y se queda con la que guardó la
 * primera. Sin eso, una de las dos cifraba el estado con una clave que ya no
 * estaba en IndexedDB y el dispositivo dejaba de abrirse.
 *
 * La clave se genera **antes** de abrir la transacción a propósito: una
 * transacción de IndexedDB se cierra si se queda sin peticiones pendientes, y
 * `generateKey` es asíncrono.
 */
async function localKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await readLocalKey(db);
  if (existing) return existing;

  const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);

  return new Promise<CryptoKey>((resolve, reject) => {
    const store = db.transaction(KEY_STORE, "readwrite").objectStore(KEY_STORE);
    const current = store.get("local");
    current.onsuccess = () => {
      const stored = current.result as CryptoKey | undefined;
      if (stored) {
        resolve(stored);
        return;
      }
      const put = store.put(candidate, "local");
      put.onsuccess = () => resolve(candidate);
      put.onerror = () => reject(put.error ?? new Error("No se pudo guardar la clave local."));
    };
    current.onerror = () =>
      reject(current.error ?? new Error("No se pudo leer la clave local."));
  });
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
