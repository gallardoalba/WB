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
  decryptClubPosts,
  decryptThread,
  encryptForClub,
  encryptForDevices,
  openDevice,
  type DeviceApi,
  type OutgoingEnvelope,
  type Session,
  type ThreadMessage,
} from "./e2e-v2-device";
import { indexedDbStore, isSupported } from "./e2e-v2-idb";
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
  async ownDevices(userId) {
    const response = await api<{ devices: { deviceId: string; oneTimeKeys: number }[] }>(
      `/api/users/${encodeURIComponent(userId)}/devices`,
    );
    return response.devices.map((device) => ({
      deviceId: device.deviceId,
      oneTimeKeys: device.oneTimeKeys,
    }));
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
    return formatSafetyNumber(await v2SafetyNumber(me, peer));
  } catch {
    return null;
  }
}

/** Descarta la sesión en memoria (al cerrar sesión o cambiar de cuenta). */
export function forgetV2Session(): void {
  session = null;
}

/**
 * Cifra un mensaje del tablón para cada dispositivo de cada miembro.
 *
 * El servidor dice quiénes son; el cliente verifica cada paquete y abre una
 * sesión con cada aparato las veces que haga falta, porque no hay protocolo de
 * grupo. Si este navegador no tiene dispositivo, devuelve `null` y el mensaje
 * sale en claro como antes.
 */
export async function encryptClub(input: {
  userId: string;
  clubId: string;
  text: string;
}): Promise<V2SendPayload | null> {
  const current = await loadV2Session(input.userId).catch(() => null);
  if (!current) return null;
  try {
    const response = await api<{
      devices: { userId: string; deviceId: string; identityKey: string; signingKey: string }[];
    }>(`/api/clubs/${encodeURIComponent(input.clubId)}/devices`);
    return await encryptForClub({
      session: current,
      api: httpApi,
      clubId: input.clubId,
      conversation: `club:${input.clubId}`,
      text: input.text,
      devices: response.devices,
    });
  } catch {
    return null;
  }
}

/** Descifra los mensajes del tablón que traigan sobre para este dispositivo. */
export async function decryptClub(input: {
  userId: string;
  clubId: string;
  posts: {
    id: string;
    senderDeviceId?: string | null;
    envelope?: { type: number | null; body: string } | null;
  }[];
}): Promise<Record<string, string>> {
  const current = await loadV2Session(input.userId).catch(() => null);
  if (!current || !store) return {};
  const conSobre = flatPosts(input.posts).filter((post) => post.envelope);
  if (conSobre.length === 0) return {};
  try {
    const response = await api<{
      devices: { userId: string; deviceId: string; identityKey: string; signingKey: string }[];
    }>(`/api/clubs/${encodeURIComponent(input.clubId)}/devices`);
    const decoded = await decryptClubPosts({
      session: current,
      api: httpApi,
      conversation: `club:${input.clubId}`,
      devices: response.devices,
      posts: conSobre,
    });
    await store.save(current.state);
    return decoded;
  } catch {
    return {};
  }
}

/** Respuestas incluidas: el tablón las devuelve anidadas. */
function flatPosts(
  posts: {
    id: string;
    senderDeviceId?: string | null;
    envelope?: { type: number | null; body: string } | null;
    replies?: unknown[];
  }[],
): {
  id: string;
  senderDeviceId?: string | null;
  envelope?: { type: number | null; body: string } | null;
}[] {
  const flat: {
    id: string;
    senderDeviceId?: string | null;
    envelope?: { type: number | null; body: string } | null;
  }[] = [];
  for (const post of posts) {
    flat.push(post);
    const replies = post.replies as typeof posts | undefined;
    if (Array.isArray(replies)) flat.push(...flatPosts(replies));
  }
  return flat;
}

/**
 * Revela un mensaje a quien modera el club.
 *
 * El cliente re-cifra el texto que **ya descifró** para el dispositivo de cada
 * moderador y lo manda con un motivo. Es la única forma de que quien modera vea
 * el contenido, y queda registrado.
 */
export async function revealClubPost(input: {
  userId: string;
  clubId: string;
  postId: string;
  text: string;
  reason: string;
}): Promise<boolean> {
  const current = await loadV2Session(input.userId).catch(() => null);
  if (!current) return false;
  const devices = await api<{
    devices: { userId: string; deviceId: string; identityKey: string; signingKey: string }[];
  }>(`/api/clubs/${encodeURIComponent(input.clubId)}/devices`);

  // Solo los aparatos de quien modera: dueño y moderadores del club. El
  // servidor lo vuelve a comprobar; aquí se evita mandar de más.
  const moderators = await api<{ moderators: { id: string }[] }>(
    `/api/clubs/${encodeURIComponent(input.clubId)}/moderators`,
  ).catch(() => null);
  const allowed = new Set(moderators?.moderators.map((moderator) => moderator.id) ?? []);
  const targets = devices.devices.filter((device) => allowed.has(device.userId));
  if (targets.length === 0) return false;

  const { envelopes } = await encryptForClub({
    session: current,
    api: httpApi,
    clubId: input.clubId,
    conversation: `club:${input.clubId}`,
    text: input.text,
    devices: targets,
  });
  await api(`/api/clubs/${encodeURIComponent(input.clubId)}/posts/${encodeURIComponent(input.postId)}/reveal`, {
    method: "POST",
    body: { reason: input.reason, envelopes },
  });
  return true;
}
