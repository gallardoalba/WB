/**
 * Identidad de extremo a extremo del navegador: generación, guardado en
 * IndexedDB y clave privada **no extraíble**.
 *
 * Esta capa se quedaba sin pruebas con el argumento de que «IndexedDB no existe
 * en Node», y es justo donde un fallo no se nota hasta que la mensajería cifrada
 * deja de funcionar en producción: si la clave reimportada se guarda con usos o
 * con `ext` equivocados, `deriveConversationKey` falla, y si la versión del
 * registro no se comprueba, un cambio de formato deja a la gente sin leer nada.
 *
 * Aquí se sustituye IndexedDB por un doble mínimo (abrir, `get`, `put`, cierre)
 * y se comprueba lo que de verdad importa: que la clave privada no se puede
 * exportar y que aun así deriva el mismo secreto que el otro extremo.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import * as e2e from "../src/lib/e2e.ts";

/* ------------------------------------------------------------------ */
/* Doble de IndexedDB: solo lo que usa `src/lib/e2e.ts`.               */
/* ------------------------------------------------------------------ */

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
  onerror: Handler = null;
  error: unknown = null;
  #done = false;

  constructor(private readonly store: FakeStore) {}

  objectStore() {
    return {
      get: (key: string) => this.#run((request) => {
        request.result = this.store.entries.get(key);
      }),
      put: (value: unknown, key: string) => this.#run(() => {
        this.store.entries.set(key, value);
      }),
    };
  }

  /** Ejecuta la operación en un microtask, como una transacción de verdad. */
  #run(apply: (request: FakeRequest) => void): FakeRequest {
    const request = new FakeRequest();
    queueMicrotask(() => {
      apply(request);
      request.onsuccess?.();
      if (!this.#done) {
        this.#done = true;
        this.oncomplete?.();
      }
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

  close() {}
}

const E2E_DB = "wanderbibliothek-e2e";
const E2E_STORE = "identity";
const E2E_RECORD = "identity-v1";

/** Instala el doble y lo retira al terminar, pase lo que pase. */
async function withFakeIndexedDb<T>(
  run: (databases: Map<string, FakeDatabase>) => Promise<T>,
): Promise<T> {
  const databases = new Map<string, FakeDatabase>();
  (globalThis as unknown as { indexedDB?: unknown }).indexedDB = {
    open(name: string) {
      const request = new FakeRequest();
      queueMicrotask(() => {
        const database = databases.get(name) ?? new FakeDatabase();
        databases.set(name, database);
        (request as unknown as { result: FakeDatabase }).result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  try {
    return await run(databases);
  } finally {
    delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
  }
}

/** El registro guardado en el doble, si lo hay. */
function storedIdentity(databases: Map<string, FakeDatabase>) {
  return databases.get(E2E_DB)?.stores.get(E2E_STORE)?.entries.get(E2E_RECORD) as
    | e2e.Identity
    | undefined;
}

/* ------------------------------------------------------------------ */

test("sin IndexedDB el cifrado se declara no disponible y no hay identidad", async () => {
  assert.equal(e2e.isEncryptionSupported(), false, "Node no trae IndexedDB");
  assert.equal(await e2e.loadIdentity(), null);
  await assert.rejects(e2e.ensureIdentity(), /no permite el cifrado de extremo a extremo/);
});

test("la identidad nueva publica solo la clave pública y guarda una privada que no se puede exportar", async () => {
  await withFakeIndexedDb(async (databases) => {
    const identity = await e2e.ensureIdentity();

    assert.equal(identity.version, 1);
    assert.equal(identity.keyId, await e2e.keyIdFromJwk(identity.publicJwk));
    // Lo único que viaja al servidor son las coordenadas: ni `d` ni usos.
    assert.deepEqual(Object.keys(identity.publicJwk).sort(), ["crv", "kty", "x", "y"]);
    assert.equal(identity.publicJwk.kty, "EC");
    assert.equal(identity.publicJwk.crv, "P-256");

    // La privada se reimporta como no extraíble: ni la propia página la saca.
    await assert.rejects(
      crypto.subtle.exportKey("jwk", identity.privateKey),
      "la clave privada no debe poder exportarse",
    );

    const guardada = storedIdentity(databases);
    assert.equal(guardada?.keyId, identity.keyId, "la identidad se guarda en el navegador");
  });
});

test("dos navegadores se entienden con la clave privada no extraíble", async () => {
  await withFakeIndexedDb(async () => {
    const ana = await e2e.ensureIdentity();

    // El otro extremo, como en el navegador de la otra persona.
    const par = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const publica = await crypto.subtle.exportKey("jwk", par.publicKey);
    const aad = e2e.directAad("dm:ana:marcos", "usr_ana", ana.keyId);

    const mia = await e2e.deriveConversationKey(ana.privateKey, publica, "dm:ana:marcos");
    const suya = await e2e.deriveConversationKey(par.privateKey, ana.publicJwk, "dm:ana:marcos");

    const sobre = await e2e.encryptMessage(mia, "Hola desde el otro lado", aad);
    assert.equal(await e2e.decryptMessage(suya, sobre, aad), "Hola desde el otro lado");

    // Y al revés.
    const respuesta = await e2e.encryptMessage(suya, "Recibido", aad);
    assert.equal(await e2e.decryptMessage(mia, respuesta, aad), "Recibido");
  });
});

test("al volver al navegador se reutiliza la identidad guardada, no se crea otra", async () => {
  await withFakeIndexedDb(async () => {
    const primera = await e2e.ensureIdentity();
    const segunda = await e2e.ensureIdentity();
    assert.equal(segunda.keyId, primera.keyId);
    assert.equal(segunda.publicJwk.x, primera.publicJwk.x);
    assert.equal(await e2e.loadIdentity().then((identidad) => identidad?.keyId), primera.keyId);
  });
});

test("una identidad creada antes de la v16 estrena huella y se vuelve a guardar", async () => {
  await withFakeIndexedDb(async (databases) => {
    // Registro antiguo: sin `keyId`.
    const par = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const publicJwk = await crypto.subtle.exportKey("jwk", par.publicKey);
    const base = new FakeDatabase();
    base.createObjectStore(E2E_STORE);
    base.stores
      .get(E2E_STORE)!
      .entries.set(E2E_RECORD, { version: 1, publicJwk, privateKey: par.privateKey });
    databases.set(E2E_DB, base);

    const identidad = await e2e.loadIdentity();
    assert.equal(identidad?.keyId, await e2e.keyIdFromJwk(publicJwk));

    // La huella calculada se escribe de vuelta, no se recalcula en cada carga.
    assert.equal(storedIdentity(databases)?.keyId, identidad?.keyId);
  });
});

test("un registro de otra versión o incompleto no se usa", async () => {
  const casos: Record<string, unknown>[] = [
    { version: 2, publicJwk: { kty: "EC" }, keyId: "x", privateKey: {} },
    { version: 1, publicJwk: { kty: "EC" }, keyId: "x" },
    { version: 1, keyId: "x", privateKey: {} },
    {},
  ];
  for (const caso of casos) {
    await withFakeIndexedDb(async (databases) => {
      const base = new FakeDatabase();
      base.createObjectStore(E2E_STORE);
      base.stores.get(E2E_STORE)!.entries.set(E2E_RECORD, caso);
      databases.set(E2E_DB, base);

      assert.equal(
        await e2e.loadIdentity(),
        null,
        `el registro ${JSON.stringify(Object.keys(caso))} no debe darse por bueno`,
      );
      // Y con un registro inservible se genera una identidad nueva.
      const nueva = await e2e.ensureIdentity();
      assert.equal(nueva.version, 1);
      assert.match(nueva.keyId, /^[A-Za-z0-9_-]{43}$/);
    });
  }
});
