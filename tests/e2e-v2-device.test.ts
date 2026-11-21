/**
 * Cliente v2 de punta a punta, sin HTTP ni interfaz.
 *
 * Se monta aquí el `DeviceApi` sobre el repositorio de verdad —las mismas
 * funciones que sirven las rutas— y dos almacenes en memoria, y se comprueba lo
 * que ningún test de una sola pieza puede ver: que dos dispositivos cualesquiera
 * acaban hablando, que el segundo dispositivo de la misma persona recibe su
 * propio sobre, que un mensaje repetido no se descifra dos veces y que un
 * paquete cambiado se rechaza en vez de aceptarse.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import type { DeviceApi, DeviceState, DeviceStore } from "../src/lib/e2e-v2-device.ts";
import { decryptFromInbox, encryptForDevices, openDevice } from "../src/lib/e2e-v2-device.ts";
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

/**: `DeviceApi` sobre el repositorio, sin pasar por HTTP. */
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
    async claim(userId, deviceId) {
      const bundle = repo.claimOneTimeKey(userId, deviceId);
      if (!bundle?.oneTimeKey) throw new Error("Sin claves de un solo uso.");
      return { ...bundle, oneTimeKey: bundle.oneTimeKey };
    },
    async send(input) {
      repo.storeEnvelopes(currentUser, input.senderDeviceId, input.conversation, input.envelopes);
    },
    async inbox(input) {
      return repo
        .listEnvelopes(currentUser, input.deviceId, input.conversation)
        .map((envelope) => ({
          id: envelope.id,
          senderUserId: envelope.senderUserId,
          senderDeviceId: envelope.senderDeviceId,
          type: envelope.type,
          body: envelope.body,
        }));
    },
    async ack(input) {
      repo.ackEnvelopes(currentUser, input.deviceId, input.ids);
    },
  };
}

/** La API actúa como la cuenta de la sesión, igual que `route()`. */
let currentUser: string;

function store(state: { value: DeviceState | null }): DeviceStore {
  return {
    async load() {
      return state.value;
    },
    async save(next) {
      state.value = next;
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

/** Hilo de intercambio entre dos cuentas, con un ejemplar del catálogo. */
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
  return `request:${id}`;
}

/** Abre el dispositivo de una cuenta como lo haría el navegador. */
async function abrir(userId: string, deviceId?: string) {
  currentUser = userId;
  const box = { value: null as DeviceState | null };
  const session = await openDevice({ userId, store: store(box), api: api(), deviceId });
  return { session, box: store(box) };
}

test("dos dispositivos se escriben y el mensaje viaja cifrado", async () => {
  const ana = cuenta("Ana Cliente");
  const bruno = cuenta("Bruno Cliente");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-01");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-1");

  currentUser = ana;
  await encryptForDevices({
    session: deAna.session,
    api: api(),
    store: deAna.box,
    conversation: hilo,
    text: "¿Te viene bien el jueves?",
    peerUserId: bruno,
  });
  await deAna.box.save(deAna.session.state);

  // El servidor no puede leerlo: lo que hay guardado es un sobre.
  const guardados = db
    .getDb()
    .prepare("SELECT body FROM device_envelopes")
    .all() as { body: string }[];
  assert.equal(guardados.length, 1);
  assert.ok(!guardados[0]!.body.includes("jueves"), "el texto no viaja en claro");

  currentUser = bruno;
  const recibidos = await decryptFromInbox({
    session: deBruno.session,
    api: api(),
    store: deBruno.box,
    conversation: hilo,
    peerUserId: ana,
  });
  assert.deepEqual(recibidos.map((message) => message.text), ["¿Te viene bien el jueves?"]);

  // Y responde: la sesión del ratchet ya existe en los dos lados.
  currentUser = bruno;
  await encryptForDevices({
    session: deBruno.session,
    api: api(),
    store: deBruno.box,
    conversation: hilo,
    text: "El jueves me viene mal",
    peerUserId: ana,
  });
  currentUser = ana;
  const respuesta = await decryptFromInbox({
    session: deAna.session,
    api: api(),
    store: deAna.box,
    conversation: hilo,
    peerUserId: bruno,
  });
  assert.deepEqual(respuesta.map((message) => message.text), ["El jueves me viene mal"]);
});

test("el segundo dispositivo recibe su propio sobre", async () => {
  const ana = cuenta("Ana Dos");
  const bruno = cuenta("Bruno Dos");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-02");
  const primero = await abrir(bruno, "dispositivo-de-bruno-1");
  // El segundo dispositivo pide contraseña, como cualquier alta posterior.
  currentUser = bruno;
  const segundoBox = { value: null as DeviceState | null };
  const segundo = await openDevice({
    userId: bruno,
    store: store(segundoBox),
    api: api(),
    password: PASSWORD,
    deviceId: "dispositivo-de-bruno-2",
  });

  currentUser = ana;
  await encryptForDevices({
    session: deAna.session,
    api: api(),
    store: deAna.box,
    conversation: hilo,
    text: "para los dos",
    peerUserId: bruno,
  });
  await deAna.box.save(deAna.session.state);

  for (const [session, box] of [
    [primero.session, primero.box],
    [segundo, store(segundoBox)],
  ] as const) {
    currentUser = bruno;
    const recibidos = await decryptFromInbox({
      session,
      api: api(),
      store: box,
      conversation: hilo,
      peerUserId: ana,
    });
    assert.deepEqual(recibidos.map((message) => message.text), ["para los dos"]);
  }
});

test("un mensaje repetido no se descifra dos veces", async () => {
  const ana = cuenta("Ana Repite");
  const bruno = cuenta("Bruno Repite");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-03");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-3");

  currentUser = ana;
  await encryptForDevices({
    session: deAna.session,
    api: api(),
    store: deAna.box,
    conversation: hilo,
    text: "una vez",
    peerUserId: bruno,
  });
  await deAna.box.save(deAna.session.state);

  // Se copia el sobre antes de que lo recoja, para reentregarlo después.
  const copia = db
    .getDb()
    .prepare("SELECT * FROM device_envelopes WHERE conversation = ?")
    .get(hilo) as Record<string, string | number>;

  currentUser = bruno;
  const recibidos = await decryptFromInbox({
    session: deBruno.session,
    api: api(),
    store: deBruno.box,
    conversation: hilo,
    peerUserId: ana,
  });
  assert.deepEqual(recibidos.map((message) => message.text), ["una vez"]);

  db.getDb()
    .prepare(
      `INSERT INTO device_envelopes
         (id, conversation, sender_user_id, sender_device_id, recipient_user_id,
          recipient_device_id, type, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "env_00000000-0000-0000-0000-000000000000",
      copia.conversation,
      copia.sender_user_id,
      copia.sender_device_id,
      copia.recipient_user_id,
      copia.recipient_device_id,
      copia.type,
      copia.body,
      copia.created_at,
    );

  await assert.rejects(
    () =>
      decryptFromInbox({
        session: deBruno.session,
        api: api(),
        store: deBruno.box,
        conversation: hilo,
        peerUserId: ana,
      }),
    "el ratchet rechaza la clave ya usada",
  );
});

test("un dispositivo que cambia de clave se rechaza en vez de aceptarse", async () => {
  const ana = cuenta("Ana Cambia");
  const bruno = cuenta("Bruno Cambia");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-04");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-4");

  currentUser = ana;
  await encryptForDevices({
    session: deAna.session,
    api: api(),
    store: deAna.box,
    conversation: hilo,
    text: "primero",
    peerUserId: bruno,
  });
  await deAna.box.save(deAna.session.state);

  // Bruno recibe una vez: a partir de aquí tiene la clave de Ana fijada.
  currentUser = bruno;
  await decryptFromInbox({
    session: deBruno.session,
    api: api(),
    store: deBruno.box,
    conversation: hilo,
    peerUserId: ana,
  });

  // El servidor cambia la identidad del dispositivo de Ana en el registro.
  db.getDb()
    .prepare("UPDATE device_keys SET identity_key = ? WHERE device_id = ?")
    .run("Z".repeat(43), "dispositivo-de-ana-04");

  // Ana escribe con una sesión nueva (como tras reinstalar), así que su primer
  // mensaje vuelve a ser de pre-clave y Bruno tiene que mirar el registro.
  deAna.session.state.sessions = {};
  currentUser = ana;
  await encryptForDevices({
    session: deAna.session,
    api: api(),
    store: deAna.box,
    conversation: hilo,
    text: "segundo",
    peerUserId: bruno,
  });

  currentUser = bruno;
  await assert.rejects(
    () =>
      decryptFromInbox({
        session: deBruno.session,
        api: api(),
        store: deBruno.box,
        conversation: hilo,
        peerUserId: ana,
      }),
    /cambiado de clave/,
  );
});

test("abrir el dispositivo dos veces reutiliza la sesión guardada", async () => {
  const ana = cuenta("Ana Guarda");
  currentUser = ana;
  const box = { value: null as DeviceState | null };
  const primera = await openDevice({ userId: ana, store: store(box), api: api(), deviceId: "dispositivo-de-ana-05" });
  const segunda = await openDevice({ userId: ana, store: store(box), api: api() });

  assert.equal(segunda.state.deviceId, primera.state.deviceId, "no se crea otro dispositivo");
  assert.equal(segunda.state.pickleKey, primera.state.pickleKey);
  assert.equal(
    (await api().listDevices(ana)).length,
    1,
    "y no se publica otro paquete en el registro",
  );
});
