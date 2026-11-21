"use client";

/**
 * Puente entre la interfaz y el protocolo v2.
 *
 * La interfaz no tiene que saber de ratchets ni de claves de un solo uso: pide
 * «cifra esto para esta persona» y «descifra lo que llegue», y aquí se decide
 * con qué protocolo. Mientras convivan v1 y v2, un mensaje sale con **los dos**
 * formatos: los sobres de v1 para las ranuras antiguas y los de v2 para los
 * dispositivos. Así nadie se queda sin leer por actualizar tarde, y el día que
 * no queden ranuras v1 se quita la mitad vieja sin tocar la interfaz.
 */
import { api } from "./client-api";
import {
  decryptThread,
  encryptForDevices,
  openDevice,
  type DeviceApi,
  type OutgoingEnvelope,
  type Session,
  type ThreadMessage,
} from "./e2e-v2-device";
import { indexedDbStore, isSupported } from "./e2e-v2-idb";

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
let opening: Promise<Session | null> | null = null;

export function v2Supported(): boolean {
  return typeof window !== "undefined" && isSupported();
}

/**
 * Abre el dispositivo si ya existe. **No lo crea**: publicar la identidad de
 * este navegador es una decisión de la persona (y puede pedir contraseña), así
 * que no ocurre al abrir un hilo.
 */
export async function loadV2Session(userId: string): Promise<Session | null> {
  if (!v2Supported() || !store) return null;
  if (session?.state.userId === userId) return session;
  opening ??= (async () => {
    const existing = await store.load(userId);
    if (!existing) return null;
    session = await openDevice({ userId, store, api: httpApi });
    return session;
  })().finally(() => {
    opening = null;
  });
  return opening;
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
  const created = await openDevice({ userId, store, api: httpApi, password });
  session = created;
  return created;
}

/** Dispositivos v2 activos de una cuenta; vacío si no tiene o no hay red. */
export async function peerDeviceCount(userId: string): Promise<number> {
  try {
    return (await httpApi.listDevices(userId)).length;
  } catch {
    return 0;
  }
}

export type V2SendPayload = { senderDeviceId: string; envelopes: OutgoingEnvelope[] };

/**
 * Cifra un mensaje para los dispositivos de la otra persona.
 *
 * Devuelve `null` cuando no hay nada que hacer: este navegador no tiene
 * dispositivo v2 o la otra parte no tiene ninguno. Entonces el mensaje sale
 * solo con v1, que es lo que la interfaz ya sabía hacer.
 */
export async function encryptV2(input: {
  userId: string;
  peerUserId: string;
  conversation: string;
  text: string;
}): Promise<V2SendPayload | null> {
  const current = await loadV2Session(input.userId).catch(() => null);
  if (!current) return null;
  try {
    return await encryptForDevices({
      session: current,
      api: httpApi,
      conversation: input.conversation,
      text: input.text,
      peerUserId: input.peerUserId,
    });
  } catch {
    // Un fallo aquí no debe impedir mandar el mensaje: se manda con v1 y la
    // conversación sigue. Sin sabotear el envío por un protocolo nuevo.
    return null;
  }
}

/**
 * Descifra los mensajes del hilo que traigan sobre para este dispositivo.
 *
 * Devuelve un mapa `id → texto`. Los mensajes de v1 y los dirigidos a otro
 * aparato de la misma cuenta no aparecen: esos los resuelve el camino de
 * siempre.
 */
export async function decryptV2(input: {
  userId: string;
  peerUserId: string;
  conversation: string;
  messages: ThreadMessage[];
}): Promise<Record<string, string>> {
  const current = await loadV2Session(input.userId).catch(() => null);
  if (!current) return {};
  const mine = current.state.deviceId;
  const withV2 = input.messages.filter((message) =>
    message.envelopes.some(
      (envelope) => envelope.protocol === 2 && envelope.keyId === mine,
    ),
  );
  if (withV2.length === 0) return {};
  try {
    const decrypted = await decryptThread({
      session: current,
      api: httpApi,
      store: store ?? undefined,
      conversation: input.conversation,
      peerUserId: input.peerUserId,
      messages: withV2,
    });
    return Object.fromEntries(decrypted.map((item) => [item.messageId, item.text]));
  } catch {
    return {};
  }
}

/** Descarta la sesión en memoria (al cerrar sesión o cambiar de cuenta). */
export function forgetV2Session(): void {
  session = null;
}
