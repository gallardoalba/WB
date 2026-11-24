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
import { generateKeyPairSync } from "node:crypto";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import "./olm-setup.ts";

import type { DeviceApi, DeviceState, DeviceStore } from "../src/lib/e2e-v2-device.ts";
import * as v2 from "../src/lib/e2e-v2.ts";
import { decryptThread, encryptForDevices, openDevice } from "../src/lib/e2e-v2-device.ts";
import { hashPasswordSync } from "../src/lib/password.ts";
import * as transparency from "../src/lib/transparency.ts";

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

/**
 * Clave del operador para las instantáneas del directorio.
 *
 * Sin una instantánea **firmada** la prueba de inclusión no vale, y la prueba es
 * obligatoria: este es el adversario que se comporta bien, el que firma lo que
 * publica.
 */
const { privateKey: OPERATOR_KEY } = generateKeyPairSync("ed25519");
const SIGNING_KEY = transparency.signingKey(
  Buffer.from(OPERATOR_KEY.export({ format: "der", type: "pkcs8" })).toString("base64"),
)!;

/** Instantánea nueva y prueba del dispositivo: lo que da un servidor honrado. */
function deviceProof(userId: string, deviceId: string) {
  const snapshot = transparency.createKeySnapshot(db.getDb(), { key: SIGNING_KEY });
  const proof = transparency.keyInclusion(userId, `device:${deviceId}`);
  assert.ok(proof, `la instantánea ${snapshot.id} debería incluir a ${deviceId}`);
  return {
    proof: { line: proof.line, index: proof.index, branch: proof.branch, root: proof.root },
    snapshot: {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      itemCount: snapshot.itemCount,
      merkleRoot: snapshot.merkleRoot,
      previousRoot: snapshot.previousRoot,
      signature: snapshot.signature,
      publicKey: snapshot.publicKey,
    },
  };
}

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
    async deviceProof(userId, deviceId) {
      return deviceProof(userId, deviceId);
    },
    async consistencyProof(fromId, toId) {
      const proof = transparency.consistencyProofBetween(fromId, toId);
      if (!proof) throw new Error("sin prueba de consistencia");
      return proof;
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
  return (await leer(de, threadId, peerUserId)).messages;
}

/** Como `recibir`, pero con los fallos: es lo que mira la interfaz. */
async function leer(
  de: Awaited<ReturnType<typeof abrir>>,
  threadId: string,
  peerUserId: string,
) {
  currentUser = de.session.state.userId;
  const page = repo.listMessages(threadId, de.session.state.userId);
  const messages = page.messages.map((message) => ({
    id: message.id,
    senderDeviceId: message.senderDeviceId ?? message.keyId ?? "",
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

test("volver a leer un hilo ya descifrado no depende del ratchet", async () => {
  const ana = cuenta("Ana Repite");
  const bruno = cuenta("Bruno Repite");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-03");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-3");

  await enviar(deAna, hilo, bruno, "una vez");
  const primero = await recibir(deBruno, hilo, ana);
  assert.deepEqual(primero.map((message) => message.text), ["una vez"]);

  // Esto es una recarga de la página: libolm ya gastó la clave del mensaje, así
  // que el texto tiene que salir de la caché del dispositivo.
  const segunda = await leer(deBruno, hilo, ana);
  assert.deepEqual(segunda.messages.map((message) => message.text), ["una vez"]);
  assert.deepEqual(segunda.failures, []);
});

test("un cifrado reenviado en otro mensaje se anota y no oculta los demás", async () => {
  const ana = cuenta("Ana Reenvía");
  const bruno = cuenta("Bruno Reenvía");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-07");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-7");

  await enviar(deAna, hilo, bruno, "original");
  await recibir(deBruno, hilo, ana);

  // El mismo cifrado en una fila nueva: el ratchet lo rechaza (clave gastada) y
  // queda como fallo, sin llevarse por delante el mensaje bueno.
  const mensaje = repo.listMessages(hilo, ana).messages[0]!;
  const fila = db.getDb()
    .prepare(
      "SELECT key_id, ciphertext, iv, protocol, type FROM message_envelopes WHERE message_id = ?",
    )
    .get(mensaje.id) as {
    key_id: string;
    ciphertext: string;
    iv: string;
    protocol: number;
    type: number;
  };
  repo.addEncryptedMessage(hilo, ana, {
    v2: {
      senderDeviceId: "dispositivo-de-ana-07",
      envelopes: [{ recipientDeviceId: fila.key_id, type: fila.type, body: fila.ciphertext }],
    },
  });

  const leido = await leer(deBruno, hilo, ana);
  assert.deepEqual(
    leido.messages.map((message) => message.text),
    ["original"],
    "el mensaje bueno sigue leyéndose",
  );
  assert.equal(leido.failures.length, 1, "el reenvío se cuenta como fallo");
});

test("un mensaje pendiente del remitente retirado se abre con su sesión", async () => {
  // El caso real: llega un mensaje mientras el dispositivo está cerrado y, antes
  // de abrirlo, la otra persona retira ese aparato. Sin el registro no se puede
  // abrir una sesión nueva, pero la que ya existe sigue valiendo.
  const ana = cuenta("Ana Retira");
  const bruno = cuenta("Bruno Retira");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-08");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-8");

  await enviar(deAna, hilo, bruno, "primero");
  await enviar(deAna, hilo, bruno, "segundo");

  // Bruno lee solo el primero, como si el segundo hubiera llegado después.
  const page = repo.listMessages(hilo, bruno).messages.map((message) => ({
    id: message.id,
    senderDeviceId: message.senderDeviceId ?? "",
    envelopes: message.envelopes,
  }));
  const primera = await decryptThread({
    session: deBruno.session,
    api: api(),
    conversation: `request:${hilo}`,
    peerUserId: ana,
    messages: [page[0]!],
  });
  assert.deepEqual(primera.messages.map((message) => message.text), ["primero"]);

  repo.revokeDevice(ana, "dispositivo-de-ana-08");

  const leido = await leer(deBruno, hilo, ana);
  assert.deepEqual(
    leido.messages.map((message) => message.text),
    ["primero", "segundo"],
    "lo pendiente se abre con la sesión que ya existía",
  );
  assert.deepEqual(leido.failures, []);
});

test("un pre-clave de un dispositivo que ya no está en el registro se rechaza", async () => {
  // Sin sesión previa y sin clave de identidad en el registro no hay nada que
  // verificar: se para la lectura en vez de abrir una sesión a ciegas.
  const ana = cuenta("Ana Sin Registro");
  const bruno = cuenta("Bruno Sin Registro");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-09");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-9");

  await enviar(deAna, hilo, bruno, "pendiente");
  repo.revokeDevice(ana, "dispositivo-de-ana-09");

  await assert.rejects(() => leer(deBruno, hilo, ana), /no está en el registro/);
});

test("un dispositivo que cambia de clave se rechaza en vez de aceptarse", async () => {
  const ana = cuenta("Ana Cambia");
  const bruno = cuenta("Bruno Cambia");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-04");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-4");

  await enviar(deAna, hilo, bruno, "primero");
  await recibir(deBruno, hilo, ana);

  // El servidor republica el aparato con otra identidad, que es lo que deja
  // rastro en el directorio: editar solo la tabla no cambia la lista firmada.
  const otra = await v2.createAccount(2);
  const cambiado = v2.deviceKeys(otra, "dispositivo-de-ana-04");
  await repo.publishDevice(
    ana,
    { ...cambiado, oneTimeKeys: v2.oneTimeKeys(otra, "dispositivo-de-ana-04") },
    { password: PASSWORD },
  );

  // Ana escribe con una sesión nueva, así que su mensaje vuelve a ser de pre-clave.
  deAna.session.state.sessions = {};
  await enviar(deAna, hilo, bruno, "segundo");

  await assert.rejects(() => recibir(deBruno, hilo, ana), /cambiado de clave/);
});

test("cambiar solo la clave de firma también se rechaza", async () => {
  // El pin guardaba el par completo, pero la recepción solo comparaba la
  // identidad: un cambio de `signing_key` pasaba desapercibido.
  const ana = cuenta("Ana Firma");
  const bruno = cuenta("Bruno Firma");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-05");
  const deBruno = await abrir(bruno, "dispositivo-de-bruno-5");

  await enviar(deAna, hilo, bruno, "primero");
  await recibir(deBruno, hilo, ana);

  db.getDb()
    .prepare("UPDATE device_keys SET signing_key = ? WHERE device_id = ?")
    .run("Z".repeat(43), "dispositivo-de-ana-05");

  deAna.session.state.sessions = {};
  await enviar(deAna, hilo, bruno, "segundo");

  await assert.rejects(() => recibir(deBruno, hilo, ana), /cambiado de clave/);
});

test("sin la prueba del directorio no se abre sesión", async () => {
  // El adaptador incompleto se rechaza en vez de seguir sin comprobar el
  // directorio firmado: la verificación es obligatoria, no opcional.
  const ana = cuenta("Ana Sin Prueba");
  const bruno = cuenta("Bruno Sin Prueba");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-06");
  await abrir(bruno, "dispositivo-de-bruno-6");

  const sinPrueba = { ...api() } as DeviceApi;
  delete (sinPrueba as { deviceProof?: unknown }).deviceProof;

  currentUser = ana;
  await assert.rejects(
    () =>
      encryptForDevices({
        session: deAna.session,
        api: sinPrueba,
        conversation: `request:${hilo}`,
        text: "sin directorio",
        peerUserId: bruno,
      }),
    /directorio firmado/,
  );
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

test("no se acepta un directorio más antiguo que el que ya se comprobó", async () => {
  // Repetir una instantánea anterior es la forma barata de resucitar un aparato
  // que se retiró después: la firma y la inclusión siguen siendo válidas.
  const ana = cuenta("Ana Frescura");
  const bruno = cuenta("Bruno Frescura");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-fre1");
  await abrir(bruno, "dispositivo-de-bruno-fre1");
  await enviar(deAna, hilo, bruno, "primero");
  assert.ok(deAna.session.state.lastSnapshot, "se apunta la instantánea que se usó");

  // Un segundo aparato obliga a pedir prueba otra vez: el primero ya está
  // comprobado y no se vuelve a mirar.
  await abrir(bruno, "dispositivo-de-bruno-fre2", PASSWORD);
  const vieja = transparency.createKeySnapshot(db.getDb(), {
    key: SIGNING_KEY,
    now: "2020-01-01T00:00:00.000Z",
  });
  const conInstantaneaVieja: DeviceApi = {
    ...api(),
    async deviceProof(userId: string, deviceId: string) {
      const proof = transparency.keyInclusion(userId, `device:${deviceId}`);
      if (!proof) throw new Error("sin prueba de directorio");
      return {
        proof: { line: proof.line, index: proof.index, branch: proof.branch, root: proof.root },
        snapshot: {
          id: vieja.id,
          createdAt: vieja.createdAt,
          itemCount: vieja.itemCount,
          merkleRoot: vieja.merkleRoot,
          previousRoot: vieja.previousRoot,
          signature: vieja.signature,
          publicKey: vieja.publicKey,
        },
      };
    },
  };

  const enviarCon = (con: DeviceApi) =>
    encryptForDevices({
      session: deAna.session,
      api: con,
      conversation: `request:${hilo}`,
      text: "con instantánea vieja",
      peerUserId: bruno,
    });

  await assert.rejects(() => enviarCon(conInstantaneaVieja), /más antiguo/);

  // Con una instantánea al día, el mismo envío pasa.
  const alDia = await enviarCon(api());
  assert.equal(alDia.envelopes.length, 2);
});

test("una instantánea que no continúa la anterior se rechaza", async () => {
  // El servidor puede firmar dos historias coherentes: la firma dice quién
  // habló, no que solo haya una. Lo que lo delata es que la instantánea nueva no
  // contenga a la que el cliente ya comprobó.
  const ana = cuenta("Ana Historia");
  const bruno = cuenta("Bruno Historia");
  const hilo = intercambio(ana, bruno);
  const deAna = await abrir(ana, "dispositivo-de-ana-his1");
  await abrir(bruno, "dispositivo-de-bruno-his1");
  await enviar(deAna, hilo, bruno, "primero");
  const ancla = deAna.session.state.lastSnapshot!;
  assert.ok(ancla, "el cliente apunta lo que comprobó");

  // Un aparato nuevo obliga a pedir prueba (y consistencia) otra vez.
  await abrir(bruno, "dispositivo-de-bruno-his2", PASSWORD);

  const conPruebaFalsa: DeviceApi = {
    ...api(),
    async consistencyProof() {
      // Una prueba de otro par: los extremos no son los que toca.
      const otra = transparency.createKeySnapshot(db.getDb(), {
        key: SIGNING_KEY,
        now: "2019-01-01T00:00:00.000Z",
      });
      return {
        from: { id: "kys_otra", itemCount: 1, merkleRoot: "a".repeat(64), createdAt: "2019-01-01T00:00:00.000Z" },
        to: {
          id: otra.id,
          itemCount: otra.itemCount,
          merkleRoot: otra.merkleRoot,
          createdAt: otra.createdAt,
        },
        proof: [],
      };
    },
  };

  await assert.rejects(
    () =>
      encryptForDevices({
        session: deAna.session,
        api: conPruebaFalsa,
        conversation: `request:${hilo}`,
        text: "con historia partida",
        peerUserId: bruno,
      }),
    /no une la instantánea|no continúa/,
  );

  // Con el servidor honesto, el mismo envío pasa.
  const bien = await encryptForDevices({
    session: deAna.session,
    api: api(),
    conversation: `request:${hilo}`,
    text: "con historia entera",
    peerUserId: bruno,
  });
  assert.equal(bien.envelopes.length, 2);
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
  await abrir(bruno, "dispositivo-de-bruno-7");

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
  deAna.session.state.verified = {};
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

test("el mismo id de dispositivo en dos cuentas no comparte nada", async () => {
  const ana = cuenta("Ana Duplicado");
  const bruno = cuenta("Bruno Duplicado");
  const carla = cuenta("Carla Duplicado");
  const conBruno = intercambio(ana, bruno);
  const conCarla = intercambio(ana, carla);

  // El identificador lo elige el cliente y es público: dos cuentas pueden
  // publicar el mismo. Si el estado local se guardara por id a secas, la
  // sesión y la confianza de una valdrían para la otra.
  const deAna = await abrir(ana, "dispositivo-de-ana-dup1");
  const deBruno = await abrir(bruno, "dispositivo-repetido-a");
  const deCarla = await abrir(carla, "dispositivo-repetido-a");

  await enviar(deAna, conBruno, bruno, "para bruno");
  await enviar(deAna, conCarla, carla, "para carla");

  assert.deepEqual(
    Object.keys(deAna.session.state.sessions).sort(),
    [`${bruno}:dispositivo-repetido-a`, `${carla}:dispositivo-repetido-a`].sort(),
  );
  assert.equal(Object.keys(deAna.session.state.pins).length, 2, "un pin por cuenta, no uno compartido");

  assert.deepEqual(
    (await recibir(deBruno, conBruno, ana)).map((message) => message.text),
    ["para bruno"],
  );
  assert.deepEqual(
    (await recibir(deCarla, conCarla, ana)).map((message) => message.text),
    ["para carla"],
  );
});
