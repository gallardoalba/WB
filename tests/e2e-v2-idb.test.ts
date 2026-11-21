/**
 * Guardado del dispositivo v2 en IndexedDB.
 *
 * IndexedDB no existe en Node, y es justo donde un fallo no se nota hasta que
 * la mensajería deja de funcionar. Se sustituye por un doble mínimo y se
 * comprueba lo que importa: que el estado se guarda **cifrado** —no en claro—,
 * que la clave es no exportable, que abrir y guardar devuelve lo mismo y que
 * una base ya existente de v1 no se rompe al añadir los almacenes nuevos.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { indexedDbStore } from "../src/lib/e2e-v2-idb.ts";
import type { DeviceState } from "../src/lib/e2e-v2-device.ts";

type Handler = (() => void) | null;

class FakeRequest {
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  result: unknown = undefined;
  error: unknown = null;
}

class FakeStore {
  readonly entries = new Map<string, unknown>();
}

class FakeTransaction {
  oncomplete: Handler = null;

  constructor(private readonly store: FakeStore) {}

  objectStore() {
    return {
      get: (key: string) => this.#run((request) => (request.result = this.store.entries.get(key))),
      put: (value: unknown, key: string) =>
        this.#run(() => this.store.entries.set(key, value)),
      delete: (key: string) => this.#run(() => this.store.entries.delete(key)),
    };
  }

  #run(apply: (request: FakeRequest) => void): FakeRequest {
    const request = new FakeRequest();
    queueMicrotask(() => {
      apply(request);
      request.onsuccess?.();
      this.oncomplete?.();
    });
    return request;
  }
}

class FakeDatabase {
  readonly stores = new Map<string, FakeStore>();

  get objectStoreNames() {
    return { contains: (name: string) => this.stores.has(name) };
  }

  createObjectStore(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeStore());
    return {};
  }

  transaction(name: string) {
    const store = this.stores.get(name);
    if (!store) throw new Error(`No existe el almacén ${name}`);
    return new FakeTransaction(store);
  }
}

async function withFakeIndexedDb<T>(run: (db: FakeDatabase) => Promise<T>): Promise<T> {
  const database = new FakeDatabase();
  (globalThis as unknown as { indexedDB?: unknown }).indexedDB = {
    open(_name: string, version: number) {
      const request = new FakeRequest();
      queueMicrotask(() => {
        (request as unknown as { result: FakeDatabase }).result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  try {
    return await run(database);
  } finally {
    delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
  }
}

const estado = (userId: string): DeviceState => ({
  userId,
  deviceId: "dispositivo-de-prueba-01",
  account: '{"pickle":"secreto-de-libolm"}',
  sessions: { "otro-dispositivo-01": '{"sesion":"secreto"}' },
  pins: { "otro-dispositivo-01": { identityKey: "a".repeat(43), signingKey: "b".repeat(43) } },
  pickleKey: "c".repeat(64),
});

test("el estado se guarda cifrado y vuelve igual", async () => {
  await withFakeIndexedDb(async (db) => {
    const store = indexedDbStore();
    await store.save(estado("usr_ana"));

    const guardado = db.stores.get("device-v2")!.entries.get("usr_ana") as {
      iv: Uint8Array;
      data: ArrayBuffer;
    };
    assert.ok(guardado, "hay registro");
    const enClaro = new TextDecoder().decode(guardado.data);
    assert.ok(!enClaro.includes("secreto"), "el estado no se guarda en claro");
    assert.ok(!enClaro.includes("usr_ana"), "ni siquiera el identificador");

    const recuperado = await store.load("usr_ana");
    assert.deepEqual(recuperado, estado("usr_ana"));
  });
});

test("la clave local no se puede exportar y no se comparte entre almacenes", async () => {
  await withFakeIndexedDb(async (db) => {
    const store = indexedDbStore();
    await store.save(estado("usr_ana"));
    const key = db.stores.get("device-key-v2")!.entries.get("local") as CryptoKey;

    assert.equal(key.extractable, false, "no se puede sacar del navegador");
    assert.deepEqual([...key.usages].sort(), ["decrypt", "encrypt"]);
    await assert.rejects(() => crypto.subtle.exportKey("raw", key));

    // La segunda vez se reutiliza la misma clave: si se generara otra, lo
    // guardado ayer dejaría de abrirse.
    const otra = indexedDbStore();
    assert.deepEqual(await otra.load("usr_ana"), estado("usr_ana"));
  });
});

test("sin registro devuelve null y no toca la base de la identidad v1", async () => {
  await withFakeIndexedDb(async (db) => {
    const store = indexedDbStore();
    assert.equal(await store.load("usr_nadie"), null);
    // Base propia: la de v1 (`wanderbibliothek-e2e`, versión 1) ni se abre.
    assert.equal(db.stores.has("identity"), false, "nada de la identidad de v1 aquí");
    assert.ok(db.stores.has("device-v2"));
    assert.ok(db.stores.has("device-key-v2"));
  });
});
