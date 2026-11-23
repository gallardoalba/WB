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
import { verifyDeviceProof, type DeviceProof, type KeySnapshotHeader } from "./e2e-v2-directory";

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
  /** Clave con la que el operador firma el directorio; se fija la primera vez. */
  directoryKey?: string | null;
  /** Dispositivos cuya inclusión en el directorio ya se comprobó. */
  verified?: string[];
  /** `false` mientras el alta no se haya confirmado en el servidor. */
  published?: boolean;
  /**
   * Texto ya descifrado, por mensaje. libolm consume la clave del mensaje al
   * abrirlo y no se puede volver a descifrar el mismo sobre: sin esto, la
   * segunda lectura del hilo —una recarga de la página— fallaba con
   * `BAD_MESSAGE_KEY_ID` y el mensaje desaparecía. También guarda lo que se
   * envía desde este aparato, que no lleva sobre para él.
   */
  decrypted?: Record<string, string>;
};

/**
 * Cuántos textos se guardan en el dispositivo. El historial reciente y no toda
 * la vida de la cuenta: el estado se reescribe entero en cada guardado.
 */
const DECRYPTED_CACHE_LIMIT = 500;

/**
 * Recuerda el texto de un mensaje en el estado del dispositivo.
 *
 * Es lo que permite volver a leer un hilo ya descifrado. El estado se guarda
 * cifrado con una clave no exportable (`e2e-v2-idb.ts`), así que el texto no
 * queda en claro en el perfil del navegador.
 */
export function rememberPlaintext(state: DeviceState, messageId: string, text: string): void {
  const cache = (state.decrypted ??= {});
  cache[messageId] = text;
  const ids = Object.keys(cache);
  for (const id of ids.slice(0, Math.max(0, ids.length - DECRYPTED_CACHE_LIMIT))) delete cache[id];
}

/**
 * Fallo de verificación, no un mensaje que no se puede abrir.
 *
 * Se distingue para no confundir «este sobre está roto o no es de esta sesión»
 * —que se anota y no impide leer los demás— con «este dispositivo no es el que
 * se fijó» o «no está en el directorio», que es una señal de ataque y detiene
 * la lectura.
 */
class VerificationError extends Error {}

export type DeviceStore = {
  load(userId: string): Promise<DeviceState | null>;
  save(state: DeviceState): Promise<void>;
};

/** Un sobre v2 listo para viajar dentro de un mensaje. */
export type OutgoingEnvelope = { recipientDeviceId: string; type: number; body: string };

/**
 * La otra persona no tiene ningún dispositivo activo.
 *
 * No es un fallo: es la señal de que toca v1. Se distingue del resto de errores
 * para no convertir un fallo de cifrado en un envío sin cifrar.
 */
export class NoDeviceError extends Error {}

/** Un mensaje del hilo, con los sobres que trae y quién lo firmó. */
export type ThreadMessage = {
  id: string;
  /** Dispositivo del remitente. En v2 es el `keyId` de la fila del mensaje. */
  senderDeviceId: string;
  envelopes: { keyId: string; ciphertext: string; protocol?: 1 | 2; type?: number }[];
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
  /**
   * Los dispositivos de una cuenta, con cuántas claves de un solo uso le quedan
   * a cada uno. Para los propios es lo que dispara la reposición.
   */
  ownDevices(userId: string): Promise<{ deviceId: string; oneTimeKeys: number }[]>;
  /**
   * Prueba de que el dispositivo está en la última instantánea firmada.
   *
   * Es **obligatoria**: sin ella no se abre sesión. Dejarla opcional hacía que
   * un adaptador incompleto —o una integración futura— desactivara en silencio
   * la comprobación del directorio, que es la que impide confiar en la lista de
   * dispositivos que sirve el servidor.
   */
  deviceProof(
    userId: string,
    deviceId: string,
  ): Promise<{ proof: DeviceProof; snapshot: KeySnapshotHeader }>;
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
    const session = { state: stored, account };
    // Un alta que se quedó a medias (publicada en el servidor pero sin llegar a
    // guardarse el «publicado») se termina aquí.
    if (stored.published === false) {
      const keys = v2.deviceKeys(account, stored.deviceId);
      await input.api.publish({
        ...keys,
        oneTimeKeys: v2.oneTimeKeys(account, stored.deviceId),
        password: input.password,
      });
      v2.markKeysAsPublished(account);
      stored.published = true;
      stored.account = v2.pickleAccount(account, stored.pickleKey);
      await input.store.save(stored);
    }
    // Un dispositivo que se queda sin claves de un solo uso deja de poder abrir
    // sesiones nuevas: se repone al abrirlo, no cuando ya es tarde.
    await replenishIfLow(session, input.api, input.store);
    return session;
  }

  const deviceId = input.deviceId ?? newDeviceId();
  const account = await v2.createAccount();

  // Se guarda **antes** de publicar: si el guardado falla después, quedaría un
  // dispositivo activo en el servidor cuya clave privada no existe, y el alta
  // siguiente pediría contraseña para nada.
  const pickleKey = randomSecret();
  const state: DeviceState = {
    userId: input.userId,
    deviceId,
    account: v2.pickleAccount(account, pickleKey),
    sessions: {},
    pins: {},
    pickleKey,
    published: false,
  };
  await input.store.save(state);

  const keys = v2.deviceKeys(account, deviceId);
  const oneTimeKeys = v2.oneTimeKeys(account, deviceId);
  await input.api.publish({ ...keys, oneTimeKeys, password: input.password });
  v2.markKeysAsPublished(account);

  state.published = true;
  state.account = v2.pickleAccount(account, pickleKey);
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

/**
 * Repone si al dispositivo le quedan pocas claves de un solo uso.
 *
 * Se consulta al servidor en vez de suponerlo: las claves las gasta quien
 * escribe, así que el dispositivo no puede saberlo por su cuenta. Si la
 * consulta falla, no se repone y se sigue: no poder reponer no debe impedir
 * leer ni escribir.
 */
export async function replenishIfLow(
  session: Session,
  api: DeviceApi,
  store?: DeviceStore,
): Promise<void> {
  try {
    const devices = await api.ownDevices(session.state.userId);
    const mine = devices.find((device) => device.deviceId === session.state.deviceId);
    if (!mine) return;
    await replenishKeys(session, api, mine.oneTimeKeys);
    await store?.save(session.state);
  } catch {
    // Sin red o sin cuota: se reintentará al abrir el dispositivo otra vez.
  }
}

/**
 * Repone claves de un solo uso si quedan pocas.
 *
 * Si el dispositivo ya tiene claves sin publicar —de un intento anterior que no
 * llegó a guardarse— se publican **esas** y no se generan más: generar en cada
 * intento acababa superando el tope que acepta el servidor y dejaba todos los
 * envíos posteriores en 400 para siempre.
 */
export async function replenishKeys(
  session: Session,
  api: DeviceApi,
  pending: number,
): Promise<void> {
  if (pending > ONE_TIME_KEY_FLOOR) return;
  const account = session.account;
  if (v2.oneTimeKeys(account, session.state.deviceId).length === 0) {
    account.generate_one_time_keys(ONE_TIME_KEY_BATCH);
  }
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
 * Comprueba que un dispositivo está en el directorio firmado y que la clave del
 * operador no ha cambiado desde la primera vez.
 *
 * Se hace **una vez por dispositivo**: la prueba cuesta dos peticiones y el
 * resultado no cambia mientras el dispositivo no cambie. Si el servidor no
 * ofrece la prueba, se sigue sin ella (es una comprobación añadida, no un
 * requisito para hablar) pero queda constancia en `verified`.
 */
async function assertInDirectory(
  session: Session,
  api: DeviceApi,
  peerUserId: string,
  device: { deviceId: string; identityKey: string },
): Promise<void> {
  if (session.state.verified?.includes(device.deviceId)) return;

  // El tipo ya la exige, pero un adaptador escrito en JavaScript puede omitirla:
  // sin prueba no hay sesión, en vez de seguir como si el directorio cuadrara.
  const answer: { proof: DeviceProof; snapshot: KeySnapshotHeader } | null | undefined =
    await api.deviceProof?.(peerUserId, device.deviceId);
  if (!answer?.proof || !answer.snapshot) {
    throw new VerificationError(
      "El servidor no ha dado prueba de que ese dispositivo esté en el directorio firmado.",
    );
  }
  const { proof, snapshot } = answer;
  const result = await verifyDeviceProof(proof, snapshot, device.identityKey);
  if (!result.ok) {
    throw new VerificationError(`Ese dispositivo no está en el directorio firmado: ${result.reason}`);
  }
  if (session.state.directoryKey && snapshot.publicKey !== session.state.directoryKey) {
    throw new VerificationError("La clave con la que se firma el directorio ha cambiado sin avisar.");
  }
  session.state.directoryKey ??= snapshot.publicKey;
  session.state.verified = [...(session.state.verified ?? []), device.deviceId];
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
  apiStore?: DeviceStore;
  conversation: string;
  text: string;
  peerUserId: string;
}): Promise<{ senderDeviceId: string; envelopes: OutgoingEnvelope[] }> {
  const { session, api, conversation, text, peerUserId } = input;
  const devices = await api.listDevices(peerUserId);
  if (devices.length === 0) throw new NoDeviceError("La otra persona no tiene ningún dispositivo activo.");

  const envelopes: OutgoingEnvelope[] = [];
  for (const device of devices) {
    const existing = session.state.sessions[device.deviceId];
    let sessionFor: v2.OlmSession;
    if (existing) {
      sessionFor = await v2.unpickleSession(existing, session.state.pickleKey);
    } else {
      await assertInDirectory(session, api, peerUserId, device);
      const bundle = await api.claim(peerUserId, device.deviceId);
      // El paquete reclamado y el que publica el registro tienen que ser el
      // mismo: si no, el servidor está enseñando dos verdades distintas.
      if (bundle.identityKey !== device.identityKey || bundle.signingKey !== device.signingKey) {
        throw new VerificationError("El paquete reclamado no coincide con el del registro.");
      }
      sessionFor = await v2.startVerifiedSession(
        session.account,
        bundle,
        session.state.pins[device.deviceId],
      );
    }

    const envelope = v2.encrypt(sessionFor, { conversation, text });
    envelopes.push({
      recipientDeviceId: device.deviceId,
      type: envelope.type,
      body: envelope.body,
    });
    session.state.sessions[device.deviceId] = v2.pickleSession(
      sessionFor,
      session.state.pickleKey,
    );
    session.state.pins[device.deviceId] ??= {
      identityKey: device.identityKey,
      signingKey: device.signingKey,
    };
    if (existing) v2.forgetSession(sessionFor);
  }

  return { senderDeviceId: session.state.deviceId, envelopes };
}

export type DecryptFailure = { messageId: string; reason: string };

export type DecryptResult = {
  messages: { messageId: string; text: string }[];
  /** Sobres que no se han podido abrir. Uno roto no oculta los demás. */
  failures: DecryptFailure[];
};

/**
 * Descifra los mensajes del hilo: los que traigan sobre para este dispositivo y
 * los que ya se descifraron antes.
 *
 * El remitente de un mensaje de pre-clave se toma **del registro firmado**, no
 * de la fila del mensaje: si se creyera al servidor, podría atribuir un mensaje
 * a cualquiera con solo escribir otro id.
 *
 * Los mensajes que no traen sobre de v2 para este aparato —los de v1, o los de
 * otro dispositivo de la misma cuenta— se ignoran sin ruido: es lo normal
 * mientras conviven los dos protocolos.
 */
export async function decryptThread(input: {
  session: Session;
  api: DeviceApi;
  store?: DeviceStore;
  conversation: string;
  peerUserId: string;
  messages: ThreadMessage[];
}): Promise<DecryptResult> {
  const { session, api, conversation, peerUserId, messages } = input;
  const mine = session.state.deviceId;
  const cache = session.state.decrypted ?? {};

  const envelopes = new Map<string, { type?: number; ciphertext: string }>();
  for (const message of messages) {
    const envelope = message.envelopes.find(
      (item) => item.protocol === 2 && item.keyId === mine,
    );
    if (envelope) envelopes.set(message.id, envelope);
  }

  // El registro solo hace falta para abrir sesiones nuevas; los mensajes ya
  // descifrados salen de la caché y los de una sesión viva no lo necesitan, así
  // que retirar el dispositivo remitente no borra su historial.
  const needsRegistry = messages.some((message) => {
    const envelope = envelopes.get(message.id);
    if (!envelope || cache[message.id] !== undefined) return false;
    // Un mensaje normal con sesión viva se abre sin registro; un pre-clave
    // puede tener que abrir una sesión nueva y entonces sí hace falta.
    return (envelope.type ?? 0) === 0 || !session.state.sessions[message.senderDeviceId];
  });
  const registry = needsRegistry
    ? new Map((await api.listDevices(peerUserId)).map((device) => [device.deviceId, device]))
    : new Map<string, { deviceId: string; identityKey: string; signingKey: string }>();

  const texts: { messageId: string; text: string }[] = [];
  const failures: DecryptFailure[] = [];

  for (const message of messages) {
    const known = cache[message.id];
    if (known !== undefined) {
      texts.push({ messageId: message.id, text: known });
      continue;
    }
    const envelope = envelopes.get(message.id);
    if (!envelope) continue;

    const device = registry.get(message.senderDeviceId) ?? null;
    try {
      const text = await openEnvelope(
        session,
        api,
        peerUserId,
        message.senderDeviceId,
        device,
        { type: envelope.type ?? 0, body: envelope.ciphertext },
        conversation,
      );
      rememberPlaintext(session.state, message.id, text);
      texts.push({ messageId: message.id, text });
    } catch (error) {
      // Un fallo de verificación es un ataque o un registro incoherente y para
      // la lectura; un sobre que no abre se anota y se sigue con los demás.
      if (error instanceof VerificationError) throw error;
      failures.push({
        messageId: message.id,
        reason: error instanceof Error ? error.message : "No se pudo descifrar el mensaje.",
      });
    }
  }

  session.state.account = v2.pickleAccount(session.account, session.state.pickleKey);
  if (input.store) await input.store.save(session.state);
  return { messages: texts, failures };
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
  api: DeviceApi,
  peerUserId: string,
  deviceId: string,
  device: { deviceId: string; identityKey: string; signingKey: string } | null,
  envelope: { type: number; body: string },
  conversation: string,
): Promise<string> {
  const saved = session.state.sessions[deviceId];
  if (saved) {
    const previous = await v2.unpickleSession(saved, session.state.pickleKey);
    try {
      const text = v2.decrypt(previous, envelope, conversation);
      session.state.sessions[deviceId] = v2.pickleSession(previous, session.state.pickleKey);
      return text;
    } catch (error) {
      // Solo un mensaje de pre-clave puede abrir una sesión nueva; con un
      // mensaje normal, el fallo es un fallo y se propaga.
      if (envelope.type !== 0) throw error;
    } finally {
      v2.forgetSession(previous);
    }
  }

  if (!device) {
    // El registro ya no lo publica —puede haberse retirado— y no hay sesión con
    // la que abrirlo: sin clave de identidad no se puede aceptar un pre-clave.
    throw new VerificationError("Un mensaje viene de un dispositivo que no está en el registro.");
  }

  const fresh = await acceptFromRegistry(session, api, peerUserId, device, envelope);
  try {
    const text = v2.decrypt(fresh, envelope, conversation);
    session.state.sessions[deviceId] = v2.pickleSession(fresh, session.state.pickleKey);
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
  api: DeviceApi,
  peerUserId: string,
  device: { deviceId: string; identityKey: string; signingKey: string },
  envelope: { type: number; body: string },
): Promise<v2.OlmSession> {
  await assertInDirectory(session, api, peerUserId, device);
  // El par completo, como en el camino de envío: comprobar solo la identidad
  // dejaba cambiar la clave de firma sin que se notara.
  const pinned = session.state.pins[device.deviceId];
  if (
    pinned &&
    (pinned.identityKey !== device.identityKey || pinned.signingKey !== device.signingKey)
  ) {
    throw new VerificationError("El dispositivo de la otra persona ha cambiado de clave sin avisar.");
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
