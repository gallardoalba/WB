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
 * - **Un sobre se descifra una vez.** No hay confirmación al servidor: el
 *   sobre vive dentro del mensaje y se borra con él. El texto ya abierto se
 *   guarda cifrado en el dispositivo para poder releer el hilo tras recargar.
 */
import * as v2 from "./e2e-v2";
import {
  verifyConsistencyProof,
  verifyDeviceProof,
  type ConsistencyProof,
  type DeviceProof,
  type KeySnapshotHeader,
} from "./e2e-v2-directory";

/** Lo que se comprobó de un dispositivo la última vez que se miró el directorio. */
export type VerifiedDevice = {
  identityKey: string;
  signingKey: string;
  /** Raíz de la instantánea en la que estaba. Solo sirve para depurar. */
  root: string;
  /** Cuándo se comprobó por última vez, para no confiar para siempre. */
  checkedAt: string;
};

/**
 * Cuánto dura la comprobación de un dispositivo antes de volver a pedir la
 * prueba. La retirada de un aparato perdido tiene que llegar aunque la sesión
 * ya estuviera abierta; no se puede revalidar en cada mensaje (dos peticiones
 * por envío), pero tampoco dejarla indefinidamente.
 */
const DIRECTORY_RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * Clave de las tablas locales de un dispositivo ajeno.
 *
 * El `deviceId` lo elige el cliente y es público, así que dos cuentas pueden
 * tener el mismo: con el id a secas, la sesión, el pin y la verificación de una
 * cuenta valdrían para la otra, y un dispositivo podría heredar la confianza de
 * un desconocido. La cuenta forma parte de la clave.
 */
export function deviceStateKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

/** ¿Este navegador ha visto alguna vez un dispositivo de esa cuenta? */
export function hasSeenPeer(state: DeviceState, peerUserId: string): boolean {
  const prefix = `${peerUserId}:`;
  return [state.knownDevices, state.pins, state.sessions].some((map) =>
    Boolean(map && Object.keys(map).some((key) => key.startsWith(prefix))),
  );
}

/** Marca un dispositivo como visto, para el bloqueo anti-degradación. */
function rememberDevice(state: DeviceState, key: string): void {
  (state.knownDevices ??= {})[key] = true;
}

/** Borra el estado criptográfico de todos los dispositivos de una cuenta. */
export function forgetPeerState(state: DeviceState, peerUserId: string): void {
  const prefix = `${peerUserId}:`;
  const maps = [state.knownDevices, state.pins, state.sessions, state.verified];
  for (const map of maps) {
    if (!map) continue;
    for (const key of Object.keys(map)) {
      if (key.startsWith(prefix)) delete (map as Record<string, unknown>)[key];
    }
  }
}

/** Lo que se guarda en el dispositivo. Nunca sale de aquí en claro. */
export type DeviceState = {
  userId: string;
  deviceId: string;
  /** Cuenta de libolm serializada (`pickle`). */
  account: string;
  /**
   * Una sesión por dispositivo de la otra parte, también serializada. La clave
   * es `${cuenta}:${dispositivo}` (`deviceStateKey`).
   */
  sessions: Record<string, string>;
  /**
   * Claves de los dispositivos ya vistos, para detectar sustituciones. Misma
   * clave compuesta que `sessions`.
   */
  pins: Record<string, v2.PinnedDevice>;
  /**
   * Dispositivos de cada cuenta que este navegador ha llegado a verificar alguna
   * vez. No se borran cuando un dispositivo se retira: es la memoria que impide
   * degradar a v1 después de haber usado v2. Se borra solo con un reset explícito
   * de la confianza de ese par.
   */
  knownDevices?: Record<string, true>;
  /** Secreto local del bote de libolm; viaja dentro del estado ya cifrado. */
  pickleKey: string;
  /** Clave con la que el operador firma el directorio; se fija la primera vez. */
  directoryKey?: string | null;
  /**
   * Dispositivos cuya inclusión en el directorio ya se comprobó, con las claves
   * que se vieron entonces: si el dispositivo cambia de clave, la comprobación
   * se repite en vez de darla por buena.
   */
  verified?: Record<string, VerifiedDevice>;
  /**
   * Última instantánea del directorio con la que se comprobó algo, para no
   * aceptar una más antigua: sin esto, el servidor podía repetir una snapshot
   * de antes de una retirada y el cliente la daba por buena.
   */
  lastSnapshot?: { id: string; createdAt: string; root: string; itemCount: number };
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
export function rememberPlaintext(
  state: DeviceState,
  conversation: string,
  messageId: string,
  text: string,
): void {
  const cache = (state.decrypted ??= {});
  cache[`${conversation}:${messageId}`] = text;
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
export class VerificationError extends Error {}

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
  ownDevices(userId: string): Promise<
    {
      deviceId: string;
      identityKey: string;
      signingKey: string;
      bundleSignature: string;
      oneTimeKeys: number;
    }[]
  >;
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
  /**
   * Prueba de que la instantánea `to` contiene a `from`.
   *
   * Obligatoria por el mismo motivo que `deviceProof`: sin ella no se puede
   * distinguir «el directorio siguió creciendo» de «el servidor me enseña otra
   * historia» y la comprobación quedaría en nada.
   */
  consistencyProof(fromId: string, toId: string): Promise<ConsistencyProof>;
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
  if (stored && stored.userId !== input.userId) {
    throw new VerificationError("El estado guardado pertenece a otra cuenta.");
  }
  if (stored) {
    const account = await v2.unpickleAccount(stored.account, stored.pickleKey);
    try {
      const session = { state: stored, account };
      // Un alta que se quedó a medias (publicada en el servidor pero sin llegar a
      // guardarse el «publicado») se termina aquí. Las claves del intento
      // anterior se descartan y se generan otras: si el servidor sí llegó a
      // guardarlas, alguna pudo reclamarse ya; republicarlas sería reutilizar
      // una clave de un solo uso.
      if (stored.published === false) {
        account.mark_keys_as_published();
        account.generate_one_time_keys(ONE_TIME_KEY_BATCH);
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
    } catch (error) {
      v2.freeAccount(account);
      throw error;
    }
  }

  const deviceId = input.deviceId ?? newDeviceId();
  const account = await v2.createAccount();
  try {
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
    const session = { state, account };
    // Comprobar que el servidor publicó de verdad nuestras claves: si otra
    // petición o un servidor hostil las cambió, hay que decirlo antes de
    // cifrar nada. También aprovecha para reponer si quedan pocas.
    await replenishIfLow(session, input.api, input.store);
    return session;
  } catch (error) {
    v2.freeAccount(account);
    throw error;
  }
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
    if (!mine) {
      throw new VerificationError(
        "El servidor ya no publica este dispositivo. Vuelve a activar el cifrado v2 en «Mi cuenta».",
      );
    }
    const local = v2.identityKeys(session.account);
    if (mine.identityKey !== local.identityKey || mine.signingKey !== local.signingKey) {
      throw new VerificationError(
        "El servidor publica otras claves para este dispositivo. No se usa el cifrado hasta verificar la cuenta.",
      );
    }
    await replenishKeys(session, api, mine.oneTimeKeys);
    await store?.save(session.state);
  } catch (error) {
    // Un fallo de identidad no es «sin red»: no se puede seguir usando el
    // dispositivo como si nada. Lo demás se reintenta en la próxima apertura.
    if (error instanceof VerificationError) throw error;
  }
}

/**
 * Repone claves de un solo uso si quedan pocas.
 *
 * Las claves sin publicar de un intento anterior se descartan y se generan
 * nuevas. Si el intento llegó al servidor pero se perdió la respuesta, las
 * viejas pueden estar ya reclamadas; volver a publicarlas reutilizaría una
 * clave de un solo uso. Generar un lote nuevo cada vez mantiene el tope del
 * servidor bajo control y evita ese camino.
 */
export async function replenishKeys(
  session: Session,
  api: DeviceApi,
  pending: number,
): Promise<void> {
  if (pending > ONE_TIME_KEY_FLOOR) return;
  const account = session.account;
  account.mark_keys_as_published();
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

/** Lo que devuelve la ruta de prueba de un dispositivo. */
type DirectoryProofAnswer = { proof: DeviceProof; snapshot: KeySnapshotHeader };

async function readDeviceProof(
  api: DeviceApi,
  peerUserId: string,
  deviceId: string,
): Promise<DirectoryProofAnswer> {
  const answer = await api.deviceProof?.(peerUserId, deviceId);
  if (!answer?.proof || !answer.snapshot) {
    throw new VerificationError(
      "El servidor no ha dado prueba de que ese dispositivo esté en el directorio firmado.",
    );
  }
  return answer;
}

/**
 * Verifica una respuesta del directorio y deja el ancla actualizada.
 *
 * Es el único camino que debe aceptar una prueba: comprueba inclusión, firma,
 * clave del operador fijada, antigüedad y continuidad con la instantánea
 * anterior. Devuelve `revoked: true` cuando la prueba es válida pero la hoja
 * dice que el dispositivo está retirado; en ese caso el llamador decide si lo
 * poda (envío) o lo rechaza (recepción).
 */
async function verifyDirectoryAnswer(
  session: Session,
  api: DeviceApi,
  peerUserId: string,
  device: { deviceId: string; identityKey: string; signingKey: string },
  answer: DirectoryProofAnswer,
): Promise<{ revoked: boolean }> {
  const key = deviceStateKey(peerUserId, device.deviceId);
  const { proof, snapshot } = answer;
  const result = await verifyDeviceProof(proof, snapshot, {
    userId: peerUserId,
    deviceId: device.deviceId,
    identityKey: device.identityKey,
    signingKey: device.signingKey,
  });
  if (!result.ok && !result.revoked) {
    throw new VerificationError(`Ese dispositivo no está en el directorio firmado: ${result.reason}`);
  }
  if (session.state.directoryKey && snapshot.publicKey !== session.state.directoryKey) {
    throw new VerificationError("La clave con la que se firma el directorio ha cambiado sin avisar.");
  }
  // La instantánea nueva tiene que continuar la que ya se comprobó, incluso si
  // la prueba es de una retirada: si no, el servidor podría enseñar una historia
  // anterior a la retirada y usar esa prueba para hacer desaparecer un aparato.
  const last = session.state.lastSnapshot;
  if (last && last.root !== snapshot.merkleRoot) {
    if (snapshot.createdAt < last.createdAt) {
      throw new VerificationError(
        "El directorio que enseña el servidor es más antiguo que el que ya se comprobó.",
      );
    }
    const chain = await api.consistencyProof(last.id, snapshot.id);
    if (
      chain.from.id !== last.id ||
      chain.from.merkleRoot !== last.root ||
      chain.from.itemCount !== last.itemCount ||
      chain.to.id !== snapshot.id ||
      chain.to.merkleRoot !== snapshot.merkleRoot ||
      chain.to.itemCount !== snapshot.itemCount
    ) {
      throw new VerificationError(
        "La prueba de consistencia no une la instantánea que ya se comprobó con esta.",
      );
    }
    const continua = await verifyConsistencyProof(
      last.itemCount,
      last.root,
      snapshot.itemCount,
      snapshot.merkleRoot,
      chain.proof,
    );
    if (!continua) {
      throw new VerificationError("El directorio nuevo no continúa el que ya se comprobó.");
    }
  }
  session.state.directoryKey ??= snapshot.publicKey;
  session.state.lastSnapshot = {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    root: snapshot.merkleRoot,
    itemCount: snapshot.itemCount,
  };
  rememberDevice(session.state, key);
  if (result.revoked) {
    if (session.state.verified) delete session.state.verified[key];
    return { revoked: true };
  }
  (session.state.verified ??= {})[key] = {
    identityKey: device.identityKey,
    signingKey: device.signingKey,
    root: snapshot.merkleRoot,
    checkedAt: new Date().toISOString(),
  };
  return { revoked: false };
}

/**
 * Comprueba que un dispositivo está en el directorio firmado y que la clave del
 * operador no ha cambiado desde la primera vez.
 *
 * Se hace **una vez por dispositivo y clave**: la prueba cuesta dos peticiones y
 * el resultado no cambia mientras el dispositivo no cambie. Si el dispositivo
 * cambia de clave, la comprobación se repite: darla por buena para siempre
 * dejaba pasar un paquete nuevo sin volver a mirar el directorio.
 */
async function assertInDirectory(
  session: Session,
  api: DeviceApi,
  peerUserId: string,
  device: { deviceId: string; identityKey: string; signingKey: string },
  options: { force?: boolean } = {},
): Promise<{ revoked: boolean }> {
  const key = deviceStateKey(peerUserId, device.deviceId);
  const seen = session.state.verified?.[key];
  const fresh =
    seen &&
    seen.identityKey === device.identityKey &&
    seen.signingKey === device.signingKey &&
    Date.now() - Date.parse(seen.checkedAt) < DIRECTORY_RECHECK_MS;
  if (!options.force && fresh) {
    rememberDevice(session.state, key);
    return { revoked: false };
  }
  return verifyDirectoryAnswer(
    session,
    api,
    peerUserId,
    device,
    await readDeviceProof(api, peerUserId, device.deviceId),
  );
}

/**
 * Cifra un mensaje para todos los dispositivos de la otra parte.
 *
 * Cada dispositivo recibe su propio sobre. Para uno nuevo se reclama una clave
 * de un solo uso, se **verifica** el paquete y se abre la sesión; para uno ya
 * conocido se reutiliza la sesión guardada, que es lo que da el ratchet.
 */
function pruneDevice(session: Session, key: string): void {
  delete session.state.pins[key];
  delete session.state.sessions[key];
  if (session.state.verified) delete session.state.verified[key];
}

function noActiveV2(): VerificationError {
  return new VerificationError(
    "La otra persona no tiene ningún dispositivo v2 activo, pero este navegador ya vio alguno. No se envía en v1: espera a que vuelva a publicar uno.",
  );
}

export async function encryptForDevices(input: {
  session: Session;
  api: DeviceApi;
  conversation: string;
  text: string;
  peerUserId: string;
}): Promise<{ senderDeviceId: string; envelopes: OutgoingEnvelope[] }> {
  const { session, api, conversation, text, peerUserId } = input;
  const devices = await api.listDevices(peerUserId);
  const peerPrefix = `${peerUserId}:`;
  const pinnedEntries = Object.entries(session.state.pins).filter(([key]) =>
    key.startsWith(peerPrefix),
  );
  const seenPeer = hasSeenPeer(session.state, peerUserId);

  // Una lista vacía solo es «la otra persona no tiene dispositivo» si este
  // cliente no vio nunca uno suyo. Si ya lo vio, hay que pedir prueba de cada
  // dispositivo fijado: una retirada legítima permite podarlos, pero un
  // servidor que oculta uno activo no puede fabricar esa prueba. En ningún caso
  // se cae a v1 después de haber usado v2.
  if (devices.length === 0) {
    let hiddenActive = false;
    for (const [key, known] of pinnedEntries) {
      const deviceId = key.slice(peerPrefix.length);
      const check = await verifyDirectoryAnswer(
        session,
        api,
        peerUserId,
        { deviceId, ...known },
        await readDeviceProof(api, peerUserId, deviceId),
      );
      if (check.revoked) pruneDevice(session, key);
      else hiddenActive = true;
    }
    if (hiddenActive) {
      throw new VerificationError(
        "El servidor no publica un dispositivo activo de la otra persona, pero este navegador ya vio alguno. No se envía el mensaje.",
      );
    }
    if (pinnedEntries.length > 0 || seenPeer) throw noActiveV2();
    throw new NoDeviceError("La otra persona no tiene ningún dispositivo activo.");
  }

  // Antes de tocar el ratchet: el cuerpo HTTP lleva un sobre por dispositivo y
  // el servidor corta en 64 KiB. Estimar solo un sobre dejaba pasar envíos que
  // acababan en 413 después de haber cifrado.
  if (!v2.fitsForDevices(conversation, text, devices.length)) {
    throw new Error(
      `El mensaje es demasiado largo para ${devices.length} dispositivo${devices.length === 1 ? "" : "s"}: acórtalo.`,
    );
  }

  const listed = new Set(devices.map((device) => device.deviceId));
  const envelopes: OutgoingEnvelope[] = [];
  for (const device of devices) {
    const key = deviceStateKey(peerUserId, device.deviceId);
    const existing = session.state.sessions[key];
    const known = session.state.pins[key];

    // Que la lista cambie las claves bajo el mismo id no puede pasar
    // desapercibido. Si el dispositivo cambió de identidad de verdad, hay que
    // confirmar la nueva huella; el reset explícito borra el pin.
    if (
      known &&
      (known.identityKey !== device.identityKey || known.signingKey !== device.signingKey)
    ) {
      delete session.state.sessions[key];
      throw new VerificationError(
        "El dispositivo de la otra persona ha cambiado de clave. Verifica la huella y acepta el cambio antes de volver a enviar.",
      );
    }

    // La sesión puede ser de hace horas: volver a mirar el directorio de vez
    // en cuando es lo que detecta una retirada que el listado todavía incluye.
    const check = await assertInDirectory(session, api, peerUserId, device);
    if (check.revoked) {
      pruneDevice(session, key);
      continue;
    }

    let sessionFor: v2.OlmSession;
    if (existing) {
      sessionFor = await v2.unpickleSession(existing, session.state.pickleKey);
    } else {
      const bundle = await api.claim(peerUserId, device.deviceId);
      // El paquete reclamado y el que publica el registro tienen que ser el
      // mismo: si no, el servidor está enseñando dos verdades distintas.
      if (
        bundle.deviceId !== device.deviceId ||
        bundle.identityKey !== device.identityKey ||
        bundle.signingKey !== device.signingKey
      ) {
        throw new VerificationError("El paquete reclamado no coincide con el del registro.");
      }
      sessionFor = await v2.startVerifiedSession(session.account, bundle, session.state.pins[key]);
    }

    try {
      const envelope = v2.encrypt(sessionFor, { conversation, text });
      envelopes.push({
        recipientDeviceId: device.deviceId,
        type: envelope.type,
        body: envelope.body,
      });
      session.state.sessions[key] = v2.pickleSession(sessionFor, session.state.pickleKey);
      session.state.pins[key] ??= {
        identityKey: device.identityKey,
        signingKey: device.signingKey,
      };
      rememberDevice(session.state, key);
    } finally {
      // El objeto vive en el WASM: si no se suelta, cada envío deja una sesión
      // ocupando memoria hasta recargar la página. Y esto vale para las dos
      // ramas, también para la sesión recién establecida.
      v2.forgetSession(sessionFor);
    }
  }

  // Y al revés: si el servidor deja de listar un dispositivo que este cliente
  // ya conocía, hay que saber si fue una retirada real o una lista recortada.
  // La prueba de inclusión lo distingue; sin ella no se envía a medias.
  for (const [key, known] of pinnedEntries) {
    const deviceId = key.slice(peerPrefix.length);
    if (listed.has(deviceId)) continue;
    const check = await verifyDirectoryAnswer(
      session,
      api,
      peerUserId,
      { deviceId, ...known },
      await readDeviceProof(api, peerUserId, deviceId),
    );
    if (!check.revoked) {
      throw new VerificationError(
        "El servidor oculta un dispositivo activo de la otra persona. No se envía el mensaje.",
      );
    }
    pruneDevice(session, key);
  }

  if (envelopes.length === 0) throw noActiveV2();
  return { senderDeviceId: session.state.deviceId, envelopes };
}

/**
 * ¿Hay que volver a mirar el directorio para aceptar este mensaje?
 *
 * Un pre-clave siempre; un mensaje normal con sesión viva, cuando la
 * verificación del remitente ha caducado. Así una retirada también llega al
 * lado que recibe, no solo al que envía.
 */
function shouldRecheckSender(session: Session, key: string, type: number | undefined): boolean {
  if ((type ?? 0) === 0) return true;
  if (!session.state.sessions[key]) return true;
  const seen = session.state.verified?.[key];
  return !seen || Date.now() - Date.parse(seen.checkedAt) >= DIRECTORY_RECHECK_MS;
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
    return shouldRecheckSender(
      session,
      deviceStateKey(peerUserId, message.senderDeviceId),
      envelope.type,
    );
  });
  const registry = needsRegistry
    ? new Map((await api.listDevices(peerUserId)).map((device) => [device.deviceId, device]))
    : new Map<string, { deviceId: string; identityKey: string; signingKey: string }>();

  const texts: { messageId: string; text: string }[] = [];
  const failures: DecryptFailure[] = [];

  for (const message of messages) {
    const cacheKey = `${conversation}:${message.id}`;
    const known = cache[cacheKey];
    if (known !== undefined) {
      texts.push({ messageId: message.id, text: known });
      continue;
    }
    const envelope = envelopes.get(message.id);
    if (!envelope) continue;
    const device = registry.get(message.senderDeviceId) ?? null;
    const senderKey = deviceStateKey(peerUserId, message.senderDeviceId);
    try {
      // La sesión viva no basta: si el remitente se retiró o cambió de clave,
      // hay que verlo antes de mostrar un mensaje nuevo.
      if (shouldRecheckSender(session, senderKey, envelope.type)) {
        // Un mensaje pendiente de antes de la retirada sigue abriéndose con la
        // sesión que ya existe. Lo que no se permite es estrenar sesión con un
        // dispositivo que el registro ya no publica.
        if (!session.state.sessions[senderKey] && !device) {
          throw new VerificationError(
            "Un mensaje viene de un dispositivo que ya no está en el registro. No se muestra.",
          );
        }
        if (device) {
          const check = await assertInDirectory(session, api, peerUserId, device);
          if (check.revoked && !session.state.sessions[senderKey]) {
            throw new VerificationError("Ese dispositivo está retirado en el directorio.");
          }
          const pinned = session.state.pins[senderKey];
          if (
            pinned &&
            (pinned.identityKey !== device.identityKey || pinned.signingKey !== device.signingKey)
          ) {
            throw new VerificationError(
              "El dispositivo de la otra persona ha cambiado de clave sin avisar.",
            );
          }
        }
      }
      const text = await openEnvelope(
        session,
        api,
        peerUserId,
        message.senderDeviceId,
        device,
        { type: envelope.type ?? 0, body: envelope.ciphertext },
        conversation,
      );
      rememberPlaintext(session.state, conversation, message.id, text);
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
  const key = deviceStateKey(peerUserId, deviceId);
  const saved = session.state.sessions[key];
  if (saved) {
    const previous = await v2.unpickleSession(saved, session.state.pickleKey);
    try {
      const text = v2.decrypt(previous, envelope, conversation);
      session.state.sessions[key] = v2.pickleSession(previous, session.state.pickleKey);
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
    session.state.sessions[key] = v2.pickleSession(fresh, session.state.pickleKey);
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
  const check = await assertInDirectory(session, api, peerUserId, device);
  if (check.revoked) {
    throw new VerificationError("Ese dispositivo está retirado en el directorio.");
  }
  // El par completo, como en el camino de envío: comprobar solo la identidad
  // dejaba cambiar la clave de firma sin que se notara. La prueba del
  // directorio ya ata las dos claves; el pin sigue siendo la segunda barrera.
  const key = deviceStateKey(peerUserId, device.deviceId);
  const pinned = session.state.pins[key];
  if (
    pinned &&
    (pinned.identityKey !== device.identityKey || pinned.signingKey !== device.signingKey)
  ) {
    throw new VerificationError("El dispositivo de la otra persona ha cambiado de clave sin avisar.");
  }
  session.state.pins[key] = {
    identityKey: device.identityKey,
    signingKey: device.signingKey,
  };
  rememberDevice(session.state, key);
  const opened = await v2.acceptSession(session.account, device.identityKey, {
    type: envelope.type,
    body: envelope.body,
  });
  return opened;
}
