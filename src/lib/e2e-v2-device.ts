/**
 * Cliente del protocolo v2: lo que hace falta para mandar y recibir.
 *
 * La criptografía vive en `e2e-v2.ts` y el transporte en la API; aquí está la
 * política: cuándo se abre una sesión, qué se guarda y de quién se fía.
 *
 * Reglas que no se negocian:
 *
 * - **El dispositivo es la identidad.** Su cuenta libolm se guarda cifrada con
 *   una clave local no exportable (ver `e2e-v2-idb.ts`); el servidor nunca ve
 *   la clave privada.
 * - **No se abre sesión con un paquete sin verificar.** La clave de identidad y
 *   la de firma se fijan la primera vez y, a partir de ahí, un paquete distinto
 *   se rechaza en vez de aceptarse en silencio.
 * - **Cada mensaje va a cada dispositivo por separado.** Como en v1, pero con
 *   una sesión por dispositivo y no por ranura.
 * - **Un sobre se descifra una vez.** Se confirma al servidor solo después de
 *   descifrarlo: si se confirmara antes, un corte de red perdería el mensaje.
 */
import * as v2 from "./e2e-v2";

/** Lo que se guarda en el dispositivo. Nunca sale de aquí en claro. */
export type DeviceState = {
  userId: string;
  deviceId: string;
  /** Cuenta de libolm serializada (`pickle`). */
  account: string;
  /** Una sesión por dispositivo de la otra parte, también serializada. */
  sessions: Record<string, string>;
  /** Claves de los dispositivos ya vistos, para detectar sustituciones. */
  pins: Record<string, v2.PinnedDevice>;
  /** Secreto local del bote de libolm; viaja dentro del estado ya cifrado. */
  pickleKey: string;
};

export type DeviceStore = {
  load(userId: string): Promise<DeviceState | null>;
  save(state: DeviceState): Promise<void>;
};

/** Lo que el cliente necesita del servidor, para poder probarlo con dobles. */
export type DeviceApi = {
  publish(input: {
    deviceId: string;
    identityKey: string;
    signingKey: string;
    signature: string;
    oneTimeKeys: v2.SignedOneTimeKey[];
    password?: string;
  }): Promise<{ oneTimeKeys: number }>;
  listDevices(userId: string): Promise<
    { deviceId: string; identityKey: string; signingKey: string; bundleSignature: string }[]
  >;
  claim(userId: string, deviceId: string): Promise<v2.DeviceBundle>;
  send(input: {
    conversation: string;
    senderDeviceId: string;
    envelopes: { recipientDeviceId: string; type: number; body: string }[];
  }): Promise<void>;
  inbox(input: {
    deviceId: string;
    conversation: string;
  }): Promise<
    { id: string; senderUserId: string; senderDeviceId: string; type: number; body: string }[]
  >;
  ack(input: { deviceId: string; ids: string[] }): Promise<void>;
};

export type Session = { state: DeviceState; account: v2.OlmAccount };

const DEVICE_ID_BYTES = 18;
/** Por debajo de esto, se reponen claves al vuelo. */
const ONE_TIME_KEY_FLOOR = 5;
/** Cuántas se generan de golpe: el cliente publica hasta 50 por envío. */
const ONE_TIME_KEY_BATCH = 20;

/** Identificador de dispositivo: 18 bytes en base64url (24 caracteres). */
export function newDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(DEVICE_ID_BYTES));
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Abre el dispositivo de esta cuenta, o lo crea la primera vez.
 *
 * Se publica el paquete y las claves de un solo uso. Si el servidor pide
 * contraseña —porque la cuenta ya tenía identidad—, `password` es obligatoria;
 * sin ella el error sube tal cual, porque el llamador tiene que preguntarla.
 */
export async function openDevice(input: {
  userId: string;
  store: DeviceStore;
  api: DeviceApi;
  password?: string;
  deviceId?: string;
}): Promise<Session> {
  const stored = await input.store.load(input.userId);
  if (stored) {
    const account = await v2.unpickleAccount(stored.account, stored.pickleKey);
    return { state: stored, account };
  }

  const deviceId = input.deviceId ?? newDeviceId();
  const account = await v2.createAccount();
  const keys = v2.deviceKeys(account, deviceId);
  const oneTimeKeys = v2.oneTimeKeys(account, deviceId);
  await input.api.publish({ ...keys, oneTimeKeys, password: input.password });
  v2.markKeysAsPublished(account);

  const pickleKey = randomSecret();
  const state: DeviceState = {
    userId: input.userId,
    deviceId,
    account: v2.pickleAccount(account, pickleKey),
    sessions: {},
    pins: {},
    pickleKey,
  };
  await input.store.save(state);
  return { state, account };
}

/**
 * Secreto del bote de libolm.
 *
 * Es aleatorio y vive **dentro** del estado, que el almacén guarda cifrado con
 * una clave no exportable: la confidencialidad en reposo la pone el almacén
 * (`e2e-v2-idb.ts`), y esta clave evita que el bote se pueda abrir solo con
 * conocer la cuenta y el dispositivo.
 */
function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Repone claves de un solo uso si quedan pocas. */
export async function replenishKeys(
  session: Session,
  api: DeviceApi,
  pending: number,
): Promise<void> {
  if (pending > ONE_TIME_KEY_FLOOR) return;
  const account = session.account;
  account.generate_one_time_keys(ONE_TIME_KEY_BATCH);
  const keys = v2.oneTimeKeys(account, session.state.deviceId);
  const { identityKey, signingKey } = v2.identityKeys(account);
  await api.publish({
    deviceId: session.state.deviceId,
    identityKey,
    signingKey,
    signature: v2.deviceKeys(account, session.state.deviceId).signature,
    oneTimeKeys: keys,
  });
  v2.markKeysAsPublished(account);
  session.state.account = v2.pickleAccount(account, session.state.pickleKey);
}

/**
 * Cifra un mensaje para todos los dispositivos de la otra parte.
 *
 * Cada dispositivo recibe su propio sobre. Para uno nuevo se reclama una clave
 * de un solo uso, se **verifica** el paquete y se abre la sesión; para uno ya
 * conocido se reutiliza la sesión guardada, que es lo que da el ratchet.
 */
export async function encryptForDevices(input: {
  session: Session;
  api: DeviceApi;
  store: DeviceStore;
  conversation: string;
  text: string;
  peerUserId: string;
}): Promise<void> {
  const { session, api, conversation, text, peerUserId } = input;
  const devices = await api.listDevices(peerUserId);
  if (devices.length === 0) throw new Error("La otra persona no tiene ningún dispositivo activo.");

  const envelopes: { recipientDeviceId: string; type: number; body: string }[] = [];
  for (const device of devices) {
    const existing = session.state.sessions[device.deviceId];
    let sessionFor: v2.OlmSession;
    if (existing) {
      sessionFor = await v2.unpickleSession(existing, session.state.pickleKey);
    } else {
      const bundle = await api.claim(peerUserId, device.deviceId);
      // El paquete reclamado y el que publica el registro tienen que ser el
      // mismo: si no, el servidor está enseñando dos verdades distintas.
      if (bundle.identityKey !== device.identityKey || bundle.signingKey !== device.signingKey) {
        throw new Error("El paquete reclamado no coincide con el del registro.");
      }
      sessionFor = await v2.startVerifiedSession(
        session.account,
        bundle,
        session.state.pins[device.deviceId],
      );
    }

    const envelope = v2.encrypt(sessionFor, { conversation: conversation, text });
    envelopes.push({ recipientDeviceId: device.deviceId, type: envelope.type, body: envelope.body });
    session.state.sessions[device.deviceId] = v2.pickleSession(sessionFor, session.state.pickleKey);
    if (!session.state.pins[device.deviceId]) {
      session.state.pins[device.deviceId] = {
        identityKey: device.identityKey,
        signingKey: device.signingKey,
      };
    }
    if (existing) v2.forgetSession(sessionFor);
  }

  await api.send({
    conversation,
    senderDeviceId: session.state.deviceId,
    envelopes,
  });
}

/**
 * Descifra los sobres pendientes de este dispositivo y los confirma.
 *
 * El remitente de un mensaje de pre-clave se toma **del registro firmado**, no
 * del sobre: si se creyera al sobre, el servidor podría atribuir un mensaje a
 * cualquiera con solo escribirlo en una columna.
 */
export async function decryptFromInbox(input: {
  session: Session;
  api: DeviceApi;
  store: DeviceStore;
  conversation: string;
  peerUserId: string;
}): Promise<{ text: string; at: string }[]> {
  const { session, api, conversation, peerUserId } = input;
  const pending = await api.inbox({ deviceId: session.state.deviceId, conversation });
  if (pending.length === 0) return [];

  const registry = new Map(
    (await api.listDevices(peerUserId)).map((device) => [device.deviceId, device]),
  );
  const ack: string[] = [];
  const texts: { text: string; at: string }[] = [];

  for (const envelope of pending) {
    const device = registry.get(envelope.senderDeviceId);
    if (!device || envelope.senderUserId !== peerUserId) {
      // No se confirma: si el registro no lo tiene, es un problema que hay que
      // poder mirar, no algo que se descarta en silencio.
      throw new Error("Un mensaje viene de un dispositivo que no está en el registro.");
    }

    const text = await openEnvelope(session, device, envelope, conversation);
    texts.push({ text, at: new Date().toISOString() });
    ack.push(envelope.id);
  }

  session.state.account = v2.pickleAccount(session.account, session.state.pickleKey);
  await input.store.save(session.state);
  if (ack.length > 0) await api.ack({ deviceId: session.state.deviceId, ids: ack });
  return texts;
}

/**
 * Descifra un sobre con la sesión que ya hay o, si es de pre-clave y la sesión
 * anterior no sirve, abriendo una nueva.
 *
 * Sin ese reintento, la otra persona no podría volver a escribir tras
 * reinstalar: su primer mensaje sería de pre-clave, la sesión vieja no lo
 * descifraría y la conversación quedaría muda para siempre.
 */
async function openEnvelope(
  session: Session,
  device: { deviceId: string; identityKey: string; signingKey: string },
  envelope: { type: number; body: string },
  conversation: string,
): Promise<string> {
  const saved = session.state.sessions[device.deviceId];
  if (saved) {
    const previous = await v2.unpickleSession(saved, session.state.pickleKey);
    try {
      const text = v2.decrypt(previous, envelope, conversation);
      session.state.sessions[device.deviceId] = v2.pickleSession(
        previous,
        session.state.pickleKey,
      );
      return text;
    } catch (error) {
      // Solo un mensaje de pre-clave puede abrir una sesión nueva; con un
      // mensaje normal, el fallo es un fallo y se propaga.
      if (envelope.type !== 0) throw error;
    } finally {
      v2.forgetSession(previous);
    }
  }

  const fresh = await acceptFromRegistry(session, device, envelope);
  try {
    const text = v2.decrypt(fresh, envelope, conversation);
    session.state.sessions[device.deviceId] = v2.pickleSession(fresh, session.state.pickleKey);
    return text;
  } finally {
    v2.forgetSession(fresh);
  }
}

/**
 * Abre el lado receptor de una sesión usando la identidad **firmada** del
 * dispositivo remitente y la fija si es la primera vez.
 */
async function acceptFromRegistry(
  session: Session,
  device: { deviceId: string; identityKey: string; signingKey: string },
  envelope: { type: number; body: string },
): Promise<v2.OlmSession> {
  const pinned = session.state.pins[device.deviceId];
  if (pinned && pinned.identityKey !== device.identityKey) {
    throw new Error("El dispositivo de la otra persona ha cambiado de clave sin avisar.");
  }
  session.state.pins[device.deviceId] = {
    identityKey: device.identityKey,
    signingKey: device.signingKey,
  };
  const opened = await v2.acceptSession(session.account, device.identityKey, {
    type: envelope.type,
    body: envelope.body,
  });
  return opened;
}
