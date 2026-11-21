/**
 * Cliente v2 de punta a punta, sobre el repositorio de verdad.
 *
 * Aquí se juntan las piezas que por separado ya funcionaban: el dispositivo se
 * publica, se reclama una clave, se abre la sesión, el sobre viaja **dentro del
 * mensaje** del hilo y la otra parte lo descifra. Es lo que no puede ver ninguna
 * prueba de una sola capa: que dos personas acaben hablando, que el segundo
 * aparato reciba su propio sobre, que un mensaje repetido no se descifre dos
 * veces y que un dispositivo cambiado se rechace en vez de aceptarse.
 */
import "./olm-setup.ts";

import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import "./olm-setup.ts";

import type { DeviceApi, DeviceState, DeviceStore } from "../src/lib/e2e-v2-device.ts";
import { decryptThread, encryptForDevices, openDevice } from "../src/lib/e2e-v2-device.ts";
import { hashPasswordSync } from "../src/lib/password.ts";

type RepoModule = typeof import("../src/lib/repo.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let repo: RepoModule;
let db: DbModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
  db = await import("../src/lib/db/index.ts");
});

const PASSWORD = "una-contraseña-larga";

/** La API actúa como la cuenta de la sesión, igual que `route()`. */
let currentUser: string;

function api(): DeviceApi {
  return {
    async publish(input) {
      const { device } = await repo.publishDevice(
        currentUser,
        {
          deviceId: input.deviceId,
          identityKey: input.identityKey,
          signingKey: input.signingKey,
          signature: input.signature,
          oneTimeKeys: input.oneTimeKeys,
        },
        { password: input.password },
      );
      return { oneTimeKeys: device.oneTimeKeys };
    },
    async listDevices(userId) {
      return repo.listDevices(userId).map((device) => ({
        deviceId: device.deviceId,
        identityKey: device.identityKey,
        signingKey: device.signingKey,
        bundleSignature: device.bundleSignature,
      }));
    },
    async ownDevices(userId) {
      return repo.listDevices(userId).map((device) => ({
        deviceId: device.deviceId,
        oneTimeKeys: device.oneTimeKeys,
      }));
    },
    async claim(userId, deviceId) {
      const bundle = repo.claimOneTimeKey(userId, deviceId);
      if (!bundle?.oneTimeKey) throw new Error("Sin claves de un solo uso.");
      return { ...bundle, oneTimeKey: bundle.oneTimeKey };
    },
  };
}

function store(box: { value: DeviceState | null }): DeviceStore {
  return {
    async load() {
      return box.value;
    },
    async save(next) {
      box.value = next;
    },
  };
}

function cuenta(nombre: string): string {
  return repo.createUser({
    name: nombre,
    email: `${nombre.toLowerCase().replaceAll(" ", ".")}@example.org`,
    passwordHash: hashPasswordSync(PASSWORD),
    city: "Stuttgart",
  }).id;
}

function intercambio(ana: string, bruno: string): string {
  const conexion = db.getDb();
  const listing = conexion.prepare("SELECT id FROM listings LIMIT 1").get() as { id: string };
  const id = `rq_${ana.slice(-4)}${bruno.slice(-4)}`;
  conexion
    .prepare(
      `INSERT INTO requests (id, listing_id, requester_id, owner_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'accepted', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(id, listing.id, ana, bruno);
  return id;
}

async function abrir(userId: string, deviceId?: string, password?: string) {
  currentUser = userId;
  const box = { value: null as DeviceState | null };
  const session = await openDevice({ userId, store: store(box), api: api(), deviceId, password });
  return { session, box, save: () => store(box).save(session.state) };
}

/** Manda un mensaje v2 por el camino real: la fila del hilo con sus sobres. */
async function enviar(
  de: Awaited<ReturnType<typeof abrir>>,
  threadId: string,
  peerUserId: string,
  text: string,
) {
  currentUser = de.session.state.userId;
  const { senderDeviceId, envelopes } = await encryptForDevices({
    session: de.session,
    api: api(),
    conversation: `request:${threadId}`,
    text,
    peerUserId,
  });
  await de.save();
  repo.addEncryptedMessage(threadId, de.session.state.userId, {
    v2: { senderDeviceId, envelopes },
  });
}

/** Lee el hilo y devuelve lo que se puede descifrar con este dispositivo. */
async function recibir(
  de: Awaited<ReturnType<typeof abrir>>,
  threadId: string,
  peerUserId: string,
) {
  currentUser = de.session.state.userId;
  const page = repo.listMessages(threadId, de.session.state.userId);
  const messages = page.messages.map((message) => ({
    id: message.id,
    senderDeviceId: message.keyId ?? "",
    envelopes: message.envelopes,
  }));
  return decryptThread({
    session: de.session,
    api: api(),
    conversation: `request:${threadId}`,
    peerUserId,
    messages,
  });
}

test("dos dispositivos se escriben y el servidor no ve el texto", async () => {
  const ana = cuenta("Ana Cliente");
  const bruno = cuenta("Bruno Cliente");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-01");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-1");

  await enviar(deAna, hilo, bruno, "¿Te viene bien el jueves?");

  // El servidor guarda el sobre, no el texto.
  const filas = db.getDb().prepare("SELECT ciphertext FROM message_envelopes").all() as {
    ciphertext: string;
  }[];
  assert.equal(filas.length, 1);
  assert.ok(!filas[0]!.ciphertext.includes("jueves"), "el texto no viaja en claro");

  assert.deepEqual(
    (await recibir(deBruno, hilo, ana)).map((message) => message.text),
    ["¿Te viene bien el jueves?"],
  );

  await enviar(deBruno, hilo, ana, "El jueves me viene mal");
  assert.deepEqual(
    (await recibir(deAna, hilo, bruno)).map((message) => message.text),
    ["El jueves me viene mal"],
  );
});

test("cada dispositivo recibe su propio sobre y ninguno abre el del otro", async () => {
  const ana = cuenta("Ana Dos");
  const bruno = cuenta("Bruno Dos");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-02");
  const primero = await abrir(bruno, "dispositivo-de-bruno-1");
  const segundo = await abrir(bruno, "dispositivo-de-bruno-2", PASSWORD);

  await enviar(deAna, hilo, bruno, "para los dos");

  for (const de of [primero, segundo]) {
    assert.deepEqual(
      (await recibir(de, hilo, ana)).map((message) => message.text),
      ["para los dos"],
    );
  }

  // El primer aparato no puede abrir el sobre del segundo: la fila está, pero
  // no va dirigida a él.
  const delSegundo = primero.session.state.deviceId === segundo.session.state.deviceId;
  assert.equal(delSegundo, false, "son dispositivos distintos");
});

test("un mensaje repetido no se descifra dos veces", async () => {
  const ana = cuenta("Ana Repite");
  const bruno = cuenta("Bruno Repite");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-03");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-3");

  await enviar(deAna, hilo, bruno, "una vez");
  const primero = await recibir(deBruno, hilo, ana);
  assert.deepEqual(primero.map((message) => message.text), ["una vez"]);

  // Se vuelve a leer el mismo hilo sin haber avanzado el ratchet: el mensaje
  // sigue ahí y la clave ya se gastó.
  await assert.rejects(() => recibir(deBruno, hilo, ana), "el ratchet rechaza la clave usada");
});

test("un dispositivo que cambia de clave se rechaza en vez de aceptarse", async () => {
  const ana = cuenta("Ana Cambia");
  const bruno = cuenta("Bruno Cambia");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-04");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-4");

  await enviar(deAna, hilo, bruno, "primero");
  await recibir(deBruno, hilo, ana);

  db.getDb()
    .prepare("UPDATE device_keys SET identity_key = ? WHERE device_id = ?")
    .run("Z".repeat(43), "dispositivo-de-ana-04");

  // Ana escribe con una sesión nueva, así que su mensaje vuelve a ser de pre-clave.
  deAna.session.state.sessions = {};
  await enviar(deAna, hilo, bruno, "segundo");

  await assert.rejects(() => recibir(deBruno, hilo, ana), /cambiado de clave/);
});

test("abrir el dispositivo dos veces reutiliza el que ya hay", async () => {
  const ana = cuenta("Ana Guarda");
  currentUser = ana;
  const box = { value: null as DeviceState | null };
  const primera = await openDevice({
    userId: ana,
    store: store(box),
    api: api(),
    deviceId: "dispositivo-de-ana-05",
  });
  const segunda = await openDevice({ userId: ana, store: store(box), api: api() });

  assert.equal(segunda.state.deviceId, primera.state.deviceId, "no se crea otro dispositivo");
  assert.equal(segunda.state.pickleKey, primera.state.pickleKey);
  assert.equal((await api().listDevices(ana)).length, 1, "y no se publica otro paquete");
});

test("el dispositivo repone claves de un solo uso cuando se queda sin ellas", async () => {
  // Sin esto, tras veinte establecimientos el dispositivo deja de poder abrir
  // sesiones nuevas y no hay forma de recuperarlo desde la interfaz.
  const ana = cuenta("Ana Repone");
  const bruno = cuenta("Bruno Repone");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-06");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-6");

  // Se gastan todas las claves de Bruno menos una.
  currentUser = bruno;
  const total = (await api().ownDevices(bruno))[0]!.oneTimeKeys;
  for (let i = 0; i < total - 1; i += 1) repo.claimOneTimeKey(bruno, "dispositivo-de-bruno-6");
  assert.equal((await api().ownDevices(bruno))[0]!.oneTimeKeys, 1);

  // Al volver a abrir el dispositivo se repone solo.
  currentUser = bruno;
  const reopened = await openDevice({
    userId: bruno,
    store: store(deBruno.box),
    api: api(),
    deviceId: "dispositivo-de-bruno-6",
  });
  const deBrunoRepuesto = { ...deBruno, session: reopened, save: () => store(deBruno.box).save(reopened.state) };
  const despues = (await api().ownDevices(bruno))[0]!.oneTimeKeys;
  assert.ok(despues > 10, `debería haber repuesto, quedan ${despues}`);

  // Y el handshake sigue funcionando: Ana abre sesión con la clave nueva.
  await enviar(deAna, hilo, bruno, "sigo pudiendo escribirte");
  assert.deepEqual(
    (await recibir(deBrunoRepuesto, hilo, ana)).map((message) => message.text),
    ["sigo pudiendo escribirte"],
  );
});

test("el cliente rechaza un dispositivo cuya prueba no cuadra con la raíz", async () => {
  // El paquete se firma a sí mismo; sin la prueba del directorio, un servidor
  // puede enseñar un paquete legítimo de otro momento, o de otra historia.
  const transparency = await import("../src/lib/transparency.ts");
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("ed25519");
  const key = transparency.signingKey(
    Buffer.from(privateKey.export({ format: "der", type: "pkcs8" })).toString("base64"),
  )!;

  const ana = cuenta("Ana Prueba");
  const bruno = cuenta("Bruno Prueba");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-07");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-7");

  const snapshot = transparency.createKeySnapshot(db.getDb(), { key, now: "2027-06-01T00:00:00.000Z" });
  const cabecera = {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    itemCount: snapshot.itemCount,
    merkleRoot: snapshot.merkleRoot,
    previousRoot: snapshot.previousRoot,
    signature: snapshot.signature,
    publicKey: snapshot.publicKey,
  };

  /** API con prueba de directorio: la real, o una retocada para el ataque. */
  const apiConPrueba = (alterar: boolean) => {
    const base = api();
    return {
      ...base,
      async deviceProof(userId: string, deviceId: string) {
        const proof = transparency.keyInclusion(userId, `device:${deviceId}`)!;
        return {
          proof: {
            line: alterar ? proof.line.replace(/\|([A-Za-z0-9+/]{43})\|/, `|${"Z".repeat(43)}|`) : proof.line,
            index: proof.index,
            branch: proof.branch,
            root: proof.root,
          },
          snapshot: cabecera,
        };
      },
    } satisfies DeviceApi;
  };

  // Con la prueba buena, el mensaje sale.
  currentUser = ana;
  const bueno = await encryptForDevices({
    session: deAna.session,
    api: apiConPrueba(false),
    conversation: `request:${hilo}`,
    text: "con prueba",
    peerUserId: bruno,
  });
  assert.equal(bueno.envelopes.length, 1);

  // Con una prueba retocada, no se abre sesión contra ese dispositivo.
  deAna.session.state.sessions = {};
  deAna.session.state.verified = [];
  currentUser = ana;
  await assert.rejects(
    () =>
      encryptForDevices({
        session: deAna.session,
        api: apiConPrueba(true),
        conversation: `request:${hilo}`,
        text: "sin prueba",
        peerUserId: bruno,
      }),
    /directorio/,
  );
});
