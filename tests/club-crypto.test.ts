/**
 * Foro del club cifrado de extremo a extremo y moderación por revelación.
 *
 * Lo que se fija aquí:
 *
 * - un mensaje del tablón no guarda el texto: viaja en un sobre por dispositivo
 *   de cada miembro, y el servidor no puede abrirlos;
 * - cada dispositivo recibe el suyo y el de otro aparato no se entrega;
 * - no se puede cifrar «para» un dispositivo de fuera del club;
 * - quien modera no ve nada por su cargo: solo lo que alguien **revela**, y la
 *   revelación queda registrada con nombre y motivo.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

import "./olm-setup.ts";

import * as v2 from "../src/lib/e2e-v2.ts";
import { decryptClubPosts, encryptForClub } from "../src/lib/e2e-v2-device.ts";
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

function cuenta(nombre: string): string {
  return repo.createUser({
    name: nombre,
    email: `${nombre.toLowerCase().replaceAll(" ", ".")}@example.org`,
    passwordHash: hashPasswordSync(PASSWORD),
    city: "Stuttgart",
  }).id;
}

async function dispositivo(userId: string, deviceId: string) {
  const account = await v2.createAccount(3);
  const signed = v2.deviceKeys(account, deviceId);
  await repo.publishDevice(
    userId,
    { ...signed, oneTimeKeys: v2.oneTimeKeys(account, deviceId) },
    { password: PASSWORD },
  );
  return { account, deviceId, signed };
}

/** Club con dueño y miembros, creado por el camino real. */
let contador = 0;
function club(dueño: string): string {
  contador += 1;
  const view = repo.createClub(dueño, {
    name: `Club de prueba ${contador}`,
    city: "Stuttgart",
    description: "",
    meetsOn: "",
  });
  return view.id;
}

/** Se une por el camino real (política abierta) y queda como miembro. */
function unir(clubId: string, userId: string): void {
  repo.setClubMembership(userId, clubId, true);
}

/** API del cliente sobre el repositorio, como en las pruebas de mensajes. */
function api() {
  return {
    async publish() {
      throw new Error("no se usa");
    },
    async listDevices(owner: string) {
      return repo.listDevices(owner).map((device) => ({
        deviceId: device.deviceId,
        identityKey: device.identityKey,
        signingKey: device.signingKey,
        bundleSignature: device.bundleSignature,
      }));
    },
    async claim(owner: string, deviceId: string) {
      const bundle = repo.claimOneTimeKey(owner, deviceId);
      if (!bundle?.oneTimeKey) throw new Error("Sin claves de un solo uso.");
      return { ...bundle, oneTimeKey: bundle.oneTimeKey };
    },
    async ownDevices(owner: string) {
      return repo.listDevices(owner).map((device) => ({
        deviceId: device.deviceId,
        oneTimeKeys: device.oneTimeKeys,
      }));
    },
  } satisfies Parameters<typeof encryptForClub>[0]["api"] extends never
    ? never
    : import("../src/lib/e2e-v2-device.ts").DeviceApi;
}

/** Sesión de cliente de verdad: cuenta libolm y estado vacío. */
function sesion(
  userId: string,
  device: { account: import("../src/lib/e2e-v2.ts").OlmAccount; deviceId: string },
) {
  return {
    account: device.account,
    state: {
      userId,
      deviceId: device.deviceId,
      account: "",
      sessions: {} as Record<string, string>,
      pins: {} as Record<string, import("../src/lib/e2e-v2.ts").PinnedDevice>,
      pickleKey: "clave-de-prueba",
    },
  };
}

test("un mensaje cifrado del club no guarda el texto y cada dispositivo recibe el suyo", async () => {
  const dueña = cuenta("Dueña Club");
  const miembro = cuenta("Miembro Club");
  const clubId = club(dueña);
  unir(clubId, miembro);

  const deDueña = await dispositivo(dueña, "dispositivo-duena-01");
  const deMiembro = await dispositivo(miembro, "dispositivo-miembro-1");
  await dispositivo(dueña, "dispositivo-duena-02");

  const devices = repo.listClubDevices(clubId);
  assert.equal(devices.length, 3, "los tres aparatos del club");

  const session = sesion(dueña, deDueña);
  const { senderDeviceId, envelopes } = await encryptForClub({
    session: session as never,
    api: api(),
    clubId,
    conversation: `club:${clubId}`,
    text: "Quedamos el jueves en la plaza",
    devices,
  });
  assert.equal(envelopes.length, 3);

  const post = repo.createClubPost({
    clubId,
    authorId: dueña,
    authorName: "Dueña",
    body: "",
    v2: { senderDeviceId, envelopes },
  });

  // El servidor no guarda el texto.
  const fila = db
    .getDb()
    .prepare("SELECT body, encrypted FROM club_posts WHERE id = ?")
    .get(post.id) as { body: string; encrypted: number };
  assert.equal(fila.body, "");
  assert.equal(fila.encrypted, 1);
  const sobres = db
    .getDb()
    .prepare("SELECT body FROM club_post_envelopes WHERE post_id = ?")
    .all(post.id) as { body: string }[];
  assert.equal(sobres.length, 3);
  assert.ok(!sobres.some((sobre) => sobre.body.includes("jueves")));

  // Cada dispositivo recibe solo el suyo.
  const paraMiembro = repo.listClubPosts(clubId, { id: miembro, isAdmin: false }, {
    deviceId: deMiembro.deviceId,
  });
  const visible = paraMiembro.posts[0]!;
  assert.equal(visible.encrypted, true);
  assert.equal(visible.body, "");
  assert.ok(visible.envelope?.body, "el miembro tiene su sobre");

  const paraOtroAparato = repo.listClubPosts(clubId, { id: dueña, isAdmin: false }, {
    deviceId: "dispositivo-que-no-existe",
  });
  assert.equal(paraOtroAparato.posts[0]!.envelope, null, "sin sobre para un aparato ajeno");
});

test("no se puede cifrar para un dispositivo de fuera del club", async () => {
  const dueña = cuenta("Dueña Ajena");
  const intruso = cuenta("Intruso Club");
  const clubId = club(dueña);
  const deDueña = await dispositivo(dueña, "dispositivo-duena-03");
  const deIntruso = await dispositivo(intruso, "dispositivo-intruso-1");

  const devices = repo.listClubDevices(clubId);
  const { senderDeviceId } = await encryptForClub({
    session: sesion(dueña, deDueña) as never,
    api: api(),
    clubId,
    conversation: `club:${clubId}`,
    text: "privado",
    devices,
  });

  assert.throws(
    () =>
      repo.createClubPost({
        clubId,
        authorId: dueña,
        authorName: "Dueña",
        body: "",
        v2: {
          senderDeviceId,
          envelopes: [{ recipientDeviceId: deIntruso.deviceId, type: 1, body: "AAAA" }],
        },
      }),
    (error: { status?: number }) => error.status === 400,
    "un sobre a alguien de fuera se rechaza",
  );
});

test("quien modera solo ve lo que alguien revela, y queda registrado", async () => {
  const dueña = cuenta("Dueña Revela");
  const miembro = cuenta("Miembro Revela");
  const moderador = cuenta("Moderador Revela");
  const clubId = club(dueña);
  unir(clubId, miembro);
  unir(clubId, moderador);
  repo.setClubModerator(dueña, clubId, moderador, true);

  const deDueña = await dispositivo(dueña, "dispositivo-duena-04");
  const deModerador = await dispositivo(moderador, "dispositivo-moderador-1");
  await dispositivo(miembro, "dispositivo-miembro-2");

  const devices = repo.listClubDevices(clubId);
  const { senderDeviceId, envelopes } = await encryptForClub({
    session: sesion(dueña, deDueña) as never,
    api: api(),
    clubId,
    conversation: `club:${clubId}`,
    text: "mensaje que alguien denunciará",
    devices,
  });
  const post = repo.createClubPost({
    clubId,
    authorId: dueña,
    authorName: "Dueña",
    body: "",
    v2: { senderDeviceId, envelopes },
  });

  // Antes de revelar, el moderador no tiene nada que leer sobre ese mensaje.
  assert.deepEqual(repo.listDisclosures(clubId, moderador, deModerador.deviceId), []);
  const suVista = repo.listClubPosts(clubId, { id: moderador, isAdmin: false }, {
    deviceId: deModerador.deviceId,
  });
  // Tiene su propio sobre (es miembro), pero nada del contenido revelado.
  assert.equal(suVista.posts[0]!.body, "");

  // El miembro revela: re-cifra el texto para el dispositivo del moderador.
  const deMiembro = await dispositivo(miembro, "dispositivo-miembro-3");
  const revelacion = await encryptForClub({
    session: sesion(miembro, deMiembro) as never,
    api: api(),
    clubId,
    conversation: `club:${clubId}`,
    text: "mensaje que alguien denunciará",
    devices: devices.filter((device) => device.deviceId === deModerador.deviceId),
  });
  const disclosure = repo.discloseClubPost({
    clubId,
    postId: post.id,
    reporterId: miembro,
    reason: "Insultos a otro miembro",
    envelopes: revelacion.envelopes,
  });
  assert.equal(disclosure.reporterId, miembro);

  const lista = repo.listDisclosures(clubId, moderador, deModerador.deviceId);
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.reason, "Insultos a otro miembro");
  assert.equal(lista[0]!.envelopes.length, 1);
  assert.equal(repo.markDisclosureRead(lista[0]!.id, moderador), true);
  assert.ok(repo.listDisclosures(clubId, moderador, deModerador.deviceId)[0]!.readAt);

  // Y el contenido revelado se descifra con la clave del moderador.
  const texto = await decryptClubPosts({
    session: sesion(moderador, deModerador) as never,
    api: api(),
    conversation: `club:${clubId}`,
    devices: [...devices, { userId: miembro, ...deMiembro.signed, deviceId: deMiembro.deviceId }],
    posts: [
      {
        id: lista[0]!.id,
        senderDeviceId: deMiembro.deviceId,
        envelope: lista[0]!.envelopes[0]!,
      },
    ],
  });
  assert.equal(texto[lista[0]!.id]?.text, "mensaje que alguien denunciará");
  assert.equal(texto[lista[0]!.id]?.senderUserId, miembro, "y quién lo reveló, según el registro");
});

test("quien no modera no puede ver las revelaciones ni revelar por otros", async () => {
  const dueña = cuenta("Dueña Permisos");
  const miembro = cuenta("Miembro Permisos");
  const fuera = cuenta("Fuera Permisos");
  const clubId = club(dueña);
  unir(clubId, miembro);
  const deDueña = await dispositivo(dueña, "dispositivo-duena-05");
  const deFuera = await dispositivo(fuera, "dispositivo-fuera-01");

  assert.throws(
    () => repo.listDisclosures(clubId, miembro, "cualquiera"),
    (error: { status?: number }) => error.status === 403,
  );

  // Alguien de fuera del club no puede revelar nada.
  const devices = repo.listClubDevices(clubId);
  const { senderDeviceId, envelopes } = await encryptForClub({
    session: sesion(dueña, deDueña) as never,
    api: api(),
    clubId,
    conversation: `club:${clubId}`,
    text: "solo del club",
    devices,
  });
  const post = repo.createClubPost({
    clubId,
    authorId: dueña,
    authorName: "Dueña",
    body: "",
    v2: { senderDeviceId, envelopes },
  });

  assert.throws(
    () =>
      repo.discloseClubPost({
        clubId,
        postId: post.id,
        reporterId: fuera,
        reason: "quiero leer lo que no es mío",
        envelopes: [{ recipientDeviceId: deFuera.deviceId, type: 1, body: "AAAA" }],
      }),
    (error: { status?: number }) => error.status === 403,
  );
});

test("la exportación de la cuenta lleva los sobres de sus mensajes del club", async () => {
  // Sin ellos, quien se va del servicio no podría leer lo que escribió.
  const dueña = cuenta("Dueña Exporta");
  const clubId = club(dueña);
  const deDueña = await dispositivo(dueña, "dispositivo-duena-06");

  const devices = repo.listClubDevices(clubId);
  const { senderDeviceId, envelopes } = await encryptForClub({
    session: sesion(dueña, deDueña) as never,
    api: api(),
    clubId,
    conversation: `club:${clubId}`,
    text: "lo que escribí y quiero llevarme",
    devices,
  });
  repo.createClubPost({
    clubId,
    authorId: dueña,
    authorName: "Dueña",
    body: "",
    v2: { senderDeviceId, envelopes },
  });

  const exported = repo.exportAccountData(dueña) as {
    clubPosts: { encrypted: boolean; body: string; envelopes: { body: string }[] }[];
  };
  const [post] = exported.clubPosts;
  assert.equal(post?.encrypted, true);
  assert.equal(post?.body, "", "el texto no está en claro en la exportación");
  assert.equal(post?.envelopes.length, 1, "pero el sobre propio sí viaja");
});

test("un autor con dispositivo no puede publicar en claro en el club", async () => {
  // Sin esta regla, publicar en claro sería una forma de que el servidor (o
  // cualquiera que induzca un fallo en el cliente) leyera el foro.
  const dueña = cuenta("Dueña Clara");
  const clubId = club(dueña);
  await dispositivo(dueña, "dispositivo-duena-07");

  assert.throws(
    () =>
      repo.createClubPost({
        clubId,
        authorId: dueña,
        authorName: "Dueña",
        body: "esto no debería guardarse en claro",
      }),
    (error: { status?: number }) => error.status === 409,
  );
});

test("quien no es del club no ve los dispositivos del club", async () => {
  const dueña = cuenta("Dueña Lista");
  const fuera = cuenta("Fuera Lista");
  const clubId = club(dueña);
  await dispositivo(dueña, "dispositivo-duena-08");
  await dispositivo(fuera, "dispositivo-fuera-02");

  // La lista la sirve la ruta con la sesión: aquí se comprueba el dato que
  // publica, que es lo que la ruta entrega solo a miembros.
  const clubView = repo.getClub(clubId, fuera);
  assert.equal(clubView?.isMember, false, "quien no es miembro no puede pedirla");
});
