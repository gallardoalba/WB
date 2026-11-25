"use client";

/**
 * Puente entre la interfaz y el protocolo v2.
 *
 * La interfaz no tiene que saber de ratchets ni de claves de un solo uso: pide
 * «cifra esto para esta persona» y «descifra lo que llegue», y aquí se decide
 * con qué protocolo. Mientras convivan v1 y v2, un mensaje lleva sobres de v2
 * para los dispositivos de la otra parte y, solo si hace falta, la copia de v1
 * para quien todavía no tiene ninguno. Así nadie se queda sin leer por
 * actualizar tarde, y el día que no queden ranuras v1 se quita la mitad vieja
 * sin tocar la interfaz.
 */
import { api } from "./client-api";
import * as v2 from "./e2e-v2";
import {
  decryptThread,
  encryptForDevices,
  forgetPeerState,
  NoDeviceError,
  openDevice,
  rememberPlaintext,
  replenishIfLow,
  VerificationError,
  type DeviceApi,
  type OutgoingEnvelope,
  type Session,
  type ThreadMessage,
} from "./e2e-v2-device";
import { forgetDevice, indexedDbStore, isSupported } from "./e2e-v2-idb";
import { formatSafetyNumber, v2SafetyNumber } from "./e2e-v2-safety";

/** La API real, tal y como la ven las rutas. */
const httpApi: DeviceApi = {
  async publish(input) {
    const response = await api<{ device: { oneTimeKeys: number } }>(
      `/api/account/devices/${encodeURIComponent(input.deviceId)}`,
      { method: "PUT", body: input },
    );
    return { oneTimeKeys: response.device.oneTimeKeys };
  },
  async listDevices(userId) {
    const response = await api<{
      devices: {
        deviceId: string;
        identityKey: string;
        signingKey: string;
        bundleSignature: string;
      }[];
    }>(`/api/users/${encodeURIComponent(userId)}/devices`);
    return response.devices;
  },
  async deviceProof(userId, deviceId) {
    return api<{
      proof: import("./e2e-v2-directory").DeviceProof;
      snapshot: import("./e2e-v2-directory").KeySnapshotHeader;
    }>(
      `/api/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}/proof`,
    );
  },
  async ownDevices() {
    const response = await api<{
      devices: {
        deviceId: string;
        identityKey: string;
        signingKey: string;
        bundleSignature: string;
        oneTimeKeys: number;
      }[];
    }>("/api/account/devices");
    return response.devices.map((device) => ({
      deviceId: device.deviceId,
      identityKey: device.identityKey,
      signingKey: device.signingKey,
      bundleSignature: device.bundleSignature,
      oneTimeKeys: device.oneTimeKeys,
    }));
  },
  async consistencyProof(fromId, toId) {
    return api(
      `/api/transparency/keys/consistency?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`,
    );
  },
  async claim(userId, deviceId) {
    const response = await api<{ bundle: Awaited<ReturnType<DeviceApi["claim"]>> }>(
      `/api/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}/claim`,
      { method: "POST" },
    );
    return response.bundle;
  },
};

const store = typeof window === "undefined" ? null : indexedDbStore();

/** Sesión abierta en esta pestaña. Se intenta una vez por carga. */
let session: Session | null = null;
const opening = new Map<string, Promise<Session | null>>();

export function v2Supported(): boolean {
  if (typeof window === "undefined" || !isSupported()) return false;
  // Sin cerrojo entre pestañas no se toca el estado (ver `withLock`).
  return Boolean((navigator as Navigator & { locks?: LockManager }).locks?.request);
}

/**
 * Serializa el acceso al dispositivo entre **pestañas**.
 *
 * El estado (la cuenta de libolm y sus sesiones) se guarda entero: dos pestañas
 * que cifran a la vez se pisan el ratchet y, a partir de ahí, los mensajes
 * dejan de abrirse sin ningún error visible. `navigator.locks` da un cerrojo por
 * cuenta dentro del navegador.
 *
 * Donde no exista —Safari anterior a 15.4, Firefox anterior a 96— se falla en
 * vez de seguir sin él: un ratchet pisado no da error, deja la conversación
 * muda, y eso es peor que decir que este navegador no puede. La interfaz lo
 * consulta antes con `v2Supported()`.
 */
export async function withLock<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) {
    throw new Error(
      "Este navegador no puede bloquear el estado del cifrado entre pestañas; actualízalo para usar el cifrado v2.",
    );
  }
  return locks.request(`wanderbibliothek:e2e-v2:${userId}`, run);
}

/**
 * Ejecuta una operación con el estado **más reciente** del almacén y lo guarda
 * al terminar, todo dentro del cerrojo.
 *
 * Releer dentro del cerrojo es lo que hace que la segunda pestaña no escriba
 * encima de lo que hizo la primera: la copia en memoria puede estar vieja.
 */
async function withSession<T>(userId: string, run: (session: Session) => Promise<T>): Promise<T> {
  if (!store) throw new Error("Sin almacén de dispositivo.");
  return withLock(userId, async () => {
    const state = await store.load(userId);
    // `NoDeviceError`, no un `Error` suelto: el llamador distingue «no hay
    // dispositivo» de «el dispositivo no se puede abrir».
    if (!state) throw new NoDeviceError("No hay dispositivo en este navegador.");
    if (state.userId !== userId) {
      throw new VerificationError("El estado guardado pertenece a otra cuenta.");
    }
    const account = await v2.unpickleAccount(state.account, state.pickleKey);
    const current: Session = { state, account };
    try {
      const result = await run(current);
      await store.save(current.state);
      return result;
    } finally {
      // Las cuentas viven en el heap de WASM: sin `free()` se acumula una por
      // operación. La copia en memoria también deja de ser fiable y se suelta
      // aquí para que la próxima lectura la recargue.
      v2.freeAccount(account);
      freeCachedSession();
    }
  });
}

/** Suelta la cuenta cacheada de la pestaña, si la hay. */
function freeCachedSession(): void {
  if (session) {
    v2.freeAccount(session.account);
    session = null;
  }
}

/**
 * Abre el dispositivo si ya existe. **No lo crea**: publicar la identidad de
 * este navegador es una decisión de la persona (y puede pedir contraseña), así
 * que no ocurre al abrir un hilo.
 */
export async function loadV2Session(userId: string): Promise<Session | null> {
  if (!v2Supported() || !store) return null;
  if (session?.state.userId === userId) return session;
  const pending = opening.get(userId);
  if (pending) return pending;

  // Abrir también puede publicar/repner claves y guardar el estado: tiene que
  // ocurrir dentro del mismo cerrojo que el resto de operaciones. Antes se
  // hacía fuera y dos pestañas podían pisarse el ratchet al cargar a la vez.
  const promise = withLock(userId, async () => {
    if (session?.state.userId === userId) return session;
    const existing = await store.load(userId);
    if (!existing) return null;
    const next = await openDevice({ userId, store, api: httpApi });
    if (session && session !== next) v2.freeAccount(session.account);
    session = next;
    return next;
  }).finally(() => {
    opening.delete(userId);
  });
  opening.set(userId, promise);
  return promise;
}

/** ¿Hay dispositivo v2 en este navegador? Sin abrirlo ni publicar nada. */
export async function hasV2Device(userId: string): Promise<boolean> {
  if (!v2Supported() || !store) return false;
  return (await store.load(userId)) !== null;
}

/**
 * Crea y publica el dispositivo de este navegador.
 *
 * Lanza un error con estado 428 si el servidor pide contraseña —la cuenta ya
 * tenía identidad— para que la interfaz la pida y vuelva a llamar con ella.
 */
export async function activateV2(userId: string, password?: string): Promise<Session> {
  if (!v2Supported() || !store) {
    throw new Error("Este navegador no puede guardar la clave de cifrado.");
  }
  // Dentro del cerrojo: dos pestañas activando a la vez publicarían dos
  // dispositivos y la segunda pisaría el estado de la primera.
  const created = await withLock(userId, () =>
    openDevice({ userId, store, api: httpApi, password }),
  );
  if (session && session !== created) v2.freeAccount(session.account);
  session = created;
  return created;
}

export type V2SendPayload = { senderDeviceId: string; envelopes: OutgoingEnvelope[] };

/**
 * Resultado de intentar cifrar con v2.
 *
 * «No hay dispositivo» no es un fallo: sin dispositivo en la otra punta, v1 es
 * lo correcto. Un fallo de cifrado o de verificación **sí** lo es, y no puede
 * convertirse en un envío en claro: el servidor lo rechazaría (regla
 * anti-degradación) o, peor, saldría un mensaje que la otra parte no puede leer.
 */
export type V2EncryptResult =
  | { status: "ok"; payload: V2SendPayload }
  | { status: "no-device" }
  | { status: "error"; message: string };

/** Cifra un mensaje para los dispositivos de la otra persona. */
export async function encryptV2(input: {
  userId: string;
  peerUserId: string;
  conversation: string;
  text: string;
}): Promise<V2EncryptResult> {
  let current: Session | null;
  try {
    current = await loadV2Session(input.userId);
  } catch (error) {
    // Un dispositivo que existe pero no se puede abrir no es «no hay
    // dispositivo»: caer a v1 ahí sería degradar en silencio justo cuando algo
    // va mal (estado corrupto, IndexedDB roto, alta a medias).
    return {
      status: "error",
      message:
        error instanceof Error
          ? `No se pudo abrir el dispositivo de cifrado de este navegador: ${error.message}`
          : "No se pudo abrir el dispositivo de cifrado de este navegador.",
    };
  }
  if (!current) return { status: "no-device" };
  // Antes de tocar el ratchet: un mensaje que no cabe en un sobre se rechaza
  // ahora, con un motivo, en vez de después de cifrar para cada aparato y
  // comerse un 422 del servidor.
  if (!v2.fitsInEnvelope(input.conversation, input.text)) {
    return {
      status: "error",
      message: "El mensaje es demasiado largo para el cifrado v2: acórtalo.",
    };
  }
  try {
    // El cerrojo relee y guarda: las sesiones y las claves fijadas sobreviven a
    // la recarga y a la otra pestaña.
    const payload = await withSession(input.userId, (fresh) =>
      encryptForDevices({
        session: fresh,
        api: httpApi,
        conversation: input.conversation,
        text: input.text,
        peerUserId: input.peerUserId,
      }),
    );
    return { status: "ok", payload };
  } catch (error) {
    if (error instanceof NoDeviceError) return { status: "no-device" };
    return {
      status: "error",
      message: error instanceof Error ? error.message : "No se pudo cifrar el mensaje.",
    };
  }
}

/**
 * Guarda el texto de un mensaje que acaba de enviarse desde este dispositivo.
 *
 * El sobre que se manda va a los aparatos de la otra persona, no a este: sin
 * guardarlo aquí, la propia persona dejaría de ver lo que escribió en cuanto
 * recargara la página.
 */
export async function rememberSentV2(
  userId: string,
  conversation: string,
  messageId: string,
  text: string,
): Promise<void> {
  try {
    await withSession(userId, async (fresh) => {
      rememberPlaintext(fresh.state, conversation, messageId, text);
    });
  } catch {
    // Sin dispositivo o sin almacén no hay nada que recordar.
  }
}

/**
 * Lo que se pudo descifrar, y cuántos sobres no se pudieron abrir.
 *
 * `failed` no es decorativo: un sobre roto o de otra sesión se anota para poder
 * avisar, en vez de devolver un mapa vacío que parece «no había nada» —lo que
 * hacía invisible un ataque o un fallo de sincronización.
 */
export type V2DecodeResult = {
  texts: Record<string, string>;
  failed: number;
  /**
   * La verificación del dispositivo remitente falló (clave cambiada, prueba del
   * directorio que no cuadra). No es lo mismo que un sobre roto: aquí no se
   * muestra nada y se avisa, porque puede ser un ataque.
   */
  blocked?: string;
};

/**
 * Descifra los mensajes del hilo: los que traigan sobre para este dispositivo y
 * los que ya se descifraron antes (libolm consume la clave al abrirlos, así que
 * el texto se guarda en el estado del dispositivo).
 *
 * Los mensajes de v1 y los de otro aparato de la misma cuenta no aparecen: esos
 * los resuelve el camino de siempre.
 */
export async function decryptV2(input: {
  userId: string;
  peerUserId: string;
  conversation: string;
  messages: ThreadMessage[];
}): Promise<V2DecodeResult> {
  let current: Session | null;
  try {
    current = await loadV2Session(input.userId);
  } catch (error) {
    // Un fallo de verificación no es «no había mensajes»: es una señal de
    // identidad y la interfaz debe decirla, no contarla como sobre roto.
    if (error instanceof VerificationError) {
      return { texts: {}, failed: 0, blocked: error.message };
    }
    // Un almacén roto no es «no había mensajes»: que la interfaz lo muestre en
    // vez de dejar el hilo vacío sin explicación.
    return { texts: {}, failed: 1 };
  }
  if (!current || input.messages.length === 0) return { texts: {}, failed: 0 };
  try {
    return await withSession(input.userId, async (fresh) => {
      const decrypted = await decryptThread({
        session: fresh,
        api: httpApi,
        conversation: input.conversation,
        peerUserId: input.peerUserId,
        messages: input.messages,
      });
      // Reponer al vuelo: una pestaña abierta toda la semana también consume
      // claves de un solo uso con cada sesión nueva.
      await replenishIfLow(fresh, httpApi);
      return {
        texts: Object.fromEntries(
          decrypted.messages.map((item) => [item.messageId, item.text]),
        ),
        failed: decrypted.failures.length,
      };
    });
  } catch (error) {
    // Un fallo de verificación no es «un mensaje que no abre»: es la señal de
    // que el dispositivo de la otra persona no es el que se fijó. Se dice tal
    // cual, en vez de contarlo como un sobre corrupto.
    if (error instanceof VerificationError) {
      return { texts: {}, failed: 0, blocked: error.message };
    }
    return { texts: {}, failed: 1 };
  }
}

/**
 * Número de seguridad de los dispositivos de las dos partes.
 *
 * Se calcula con el registro **del servidor**: es lo que se compara por otro
 * canal, así que tiene que reflejar lo que el servidor publica. Si alguien
 * añade un dispositivo, el número cambia y la comparación anterior deja de
 * valer.
 */
export async function safetyWith(
  userId: string,
  peerUserId: string,
): Promise<string | null> {
  try {
    const [me, peer] = await Promise.all([
      httpApi.listDevices(userId),
      httpApi.listDevices(peerUserId),
    ]);
    // Una lista del servidor no es una huella: al menos exigimos que cada
    // paquete esté firmado por la clave que dice tener. La prueba de inclusión
    // se comprueba en los caminos de sesión; aquí no se puede fingir una lista
    // entera con claves arbitrarias sin poseer sus claves privadas.
    const signatures = await Promise.all(
      [...me, ...peer].map((device) =>
        v2.verifySignature(
          device.signingKey,
          v2.bundleMessage(device.deviceId, device.identityKey, device.signingKey),
          device.bundleSignature,
        ),
      ),
    );
    if (signatures.some((valid) => !valid)) return null;
    return formatSafetyNumber(
      await v2SafetyNumber(me, peer, { me: userId, peer: peerUserId }),
    );
  } catch {
    return null;
  }
}

/** Descarta la sesión en memoria (al cerrar sesión o cambiar de cuenta). */
export function forgetV2Session(): void {
  freeCachedSession();
  opening.clear();
}

/**
 * Olvida el dispositivo de este navegador.
 *
 * Se usa al retirarlo desde «Mi cuenta»: la clave privada ya no sirve para nada
 * porque el servidor dejó de publicarla, y conservarla solo mantiene material
 * sensible en el perfil.
 */
export async function forgetV2Device(userId: string): Promise<void> {
  forgetV2Session();
  // Sin IndexedDB no hay estado que borrar (y el test de "sin almacén" no
  // debe romper la página).
  if (!isSupported()) return;
  // Con cerrojo si el navegador lo tiene; si no, no hay forma de coordinar
  // pestañas y borrar es más seguro que dejar el material privado.
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks) await withLock(userId, () => forgetDevice(userId));
  else await forgetDevice(userId);
}

/**
 * Olvida solo los dispositivos de una cuenta con la que se habla.
 *
 * Se usa después de comparar por otro canal una huella nueva: borra sesiones,
 * pins y verificaciones de ese par, pero conserva el resto de contactos y la
 * identidad de este navegador. La siguiente operación vuelve a fijar el
 * dispositivo con la huella que se haya comprobado.
 */
export async function forgetPeerV2(userId: string, peerUserId: string): Promise<void> {
  await withSession(userId, async (fresh) => {
    forgetPeerState(fresh.state, peerUserId);
  });
}

/** Identificador del dispositivo de esta cuenta en este navegador, si existe. */
export async function deviceIdFor(userId: string): Promise<string | null> {
  if (!v2Supported() || !store) return null;
  const state = await store.load(userId).catch(() => null);
  return state?.deviceId ?? null;
}

/** Claves públicas del dispositivo local, para compararlas con el servidor. */
export async function deviceKeysFor(
  userId: string,
): Promise<{ identityKey: string; signingKey: string } | null> {
  if (!store) return null;
  const state = await store.load(userId).catch(() => null);
  if (!state) return null;
  const account = await v2.unpickleAccount(state.account, state.pickleKey);
  try {
    return v2.identityKeys(account);
  } finally {
    v2.freeAccount(account);
  }
}
