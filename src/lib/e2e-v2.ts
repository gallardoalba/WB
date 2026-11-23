/**
 * Protocolo v2: Double Ratchet sobre libolm.
 *
 * Este módulo **no implementa criptografía**: envuelve libolm —el ratchet
 * auditado que usa Matrix— y define solo lo nuestro: el identificador de
 * dispositivo, el paquete de claves que se publica, el sobre y las reglas de
 * sesión. Escribir un ratchet propio es justo lo que ninguna auditoría
 * recomienda.
 *
 * Qué aporta sobre v1:
 *
 * - Forward secrecy y post-compromise security: cada mensaje usa una clave
 *   distinta y el intercambio DH se renueva.
 * - Autenticación dentro de la sesión: solo los dos participantes tienen las
 *   claves, así que el servidor no puede fabricar un mensaje que atribuya a
 *   otro remitente. No hay firmas públicas por mensaje, así que la deniabilidad
 *   se mantiene.
 * - Firma del paquete: la identidad y **cada** clave de un solo uso van firmadas
 *   con la clave Ed25519 del dispositivo. Sin esa firma, el servidor podría
 *   cambiar la clave que entrega y quedarse en medio del handshake sin romper
 *   ningún MAC, porque libolm no firma las claves de un solo uso (X3DH sí firma
 *   su *signed prekey*).
 * - Relleno a bloques y atadura al hilo: el texto va dentro de un sobre con la
 *   conversación, así que el tamaño no revela la longitud exacta y un mensaje
 *   movido de hilo se rechaza en vez de mostrarse en el sitio equivocado.
 *
 * Las claves privadas viven en el `Account` de libolm, que el cliente guarda
 * cifrado (`pickle`) en su propio almacén. El servidor solo ve el paquete
 * público.
 */
import { bundleMessage, oneTimeKeyMessage } from "./e2e-v2-format";
import { getOlm, type OlmFactory } from "./olm-runtime";

export { bundleMessage, oneTimeKeyMessage };

type Lib = Omit<OlmFactory, "Account" | "Session" | "Utility"> & {
  Account: new () => OlmAccount;
  Session: new () => OlmSession;
  Utility: new () => OlmUtility;
};

/**
 * libolm no se importa: se pide al cargador (`olm-runtime.ts`), porque el
 * paquete trae ramas de Node que el empaquetador del navegador no sabe resolver.
 */
async function lib(): Promise<Lib> {
  return (await getOlm()) as Lib;
}

export type OlmAccount = {
  create(): void;
  free(): void;
  identity_keys(): string;
  one_time_keys(): string;
  generate_one_time_keys(count: number): void;
  mark_keys_as_published(): void;
  remove_one_time_keys(session: OlmSession): void;
  max_number_of_one_time_keys(): number;
  sign(message: string): string;
  pickle(key: string): string;
  unpickle(key: string, pickle: string): void;
};

export type OlmSession = {
  create_outbound(account: OlmAccount, identityKey: string, oneTimeKey: string): void;
  create_inbound_from(account: OlmAccount, identityKey: string, prekey: string): void;
  encrypt(plaintext: string): { type: number; body: string };
  decrypt(messageType: number, body: string): string;
  session_id(): string;
  has_received_message(): boolean;
  pickle(key: string): string;
  unpickle(key: string, pickle: string): void;
  free(): void;
};

export type OlmUtility = {
  ed25519_verify(key: string, message: string, signature: string): void;
  free(): void;
};

/** Clave pública de un dispositivo, con su firma de posesión. */
export type DeviceKeys = {
  deviceId: string;
  identityKey: string;
  signingKey: string;
  /** Firma Ed25519 del paquete con la clave del propio dispositivo. */
  signature: string;
};

/** Clave de un solo uso firmada por el dispositivo que la generó. */
export type SignedOneTimeKey = {
  keyId: string;
  key: string;
  signature: string;
};

/** Paquete completo que se publica en el servidor. */
export type DeviceBundle = DeviceKeys & {
  oneTimeKey: SignedOneTimeKey;
};

/**
 * Sobre de mensaje. `type` 0 es un mensaje de pre-clave: abre la sesión al
 * receptor. `type` 1 es un mensaje normal del ratchet.
 */
export type Envelope = { type: number; body: string };

/** Texto en claro que se cifra: el hilo va dentro, no al lado. */
export type MessageContent = { conversation: string; text: string };

const ONE_TIME_KEY_TARGET = 20;
/** Bloques de relleno, en unidades de cadena. */
const PADDING_BLOCK = 256;

let ready: Promise<void> | null = null;

/** Carga el WASM una sola vez por contexto. */
export async function init(): Promise<void> {
  ready ??= lib().then((loaded) => loaded.init());
  return ready;
}

/** Cuenta de dispositivo nueva, con claves de un solo uso ya generadas. */
export async function createAccount(oneTimeKeys = ONE_TIME_KEY_TARGET): Promise<OlmAccount> {
  await init();
  const account = new (await lib()).Account();
  account.create();
  account.generate_one_time_keys(oneTimeKeys);
  return account;
}

export function identityKeys(account: OlmAccount): { identityKey: string; signingKey: string } {
  const keys = JSON.parse(account.identity_keys()) as { curve25519: string; ed25519: string };
  return { identityKey: keys.curve25519, signingKey: keys.ed25519 };
}

/** Firma un mensaje con la clave Ed25519 del dispositivo. */
export function sign(account: OlmAccount, message: string): string {
  return account.sign(message);
}

/**
 * Verifica una firma Ed25519.
 *
 * Devuelve `false` en vez de lanzar: el cliente decide qué hacer con un paquete
 * que no cuadra (no abrir sesión, avisar), y aquí lo importante es que nunca
 * devuelva `true` sin comprobarlo.
 */
export async function verifySignature(
  signingKey: string,
  message: string,
  signature: string,
): Promise<boolean> {
  await init();
  const { Utility } = await lib();
  const utility = new Utility();
  try {
    utility.ed25519_verify(signingKey, message, signature);
    return true;
  } catch {
    return false;
  } finally {
    utility.free();
  }
}

/** Paquete del dispositivo listo para publicar, firmado. */
export function deviceKeys(account: OlmAccount, deviceId: string): DeviceKeys {
  const keys = identityKeys(account);
  return {
    deviceId,
    ...keys,
    signature: sign(account, bundleMessage(deviceId, keys.identityKey, keys.signingKey)),
  };
}

/**
 * Claves de un solo uso pendientes de publicar, cada una firmada.
 *
 * `markKeysAsPublished` se llama **después** de que el servidor las acepte: si
 * la publicación falla se reintenta con las mismas y no se pierde ninguna.
 */
export function oneTimeKeys(account: OlmAccount, deviceId: string): SignedOneTimeKey[] {
  const keys = JSON.parse(account.one_time_keys()) as { curve25519?: Record<string, string> };
  return Object.entries(keys.curve25519 ?? {}).map(([keyId, key]) => ({
    keyId,
    key,
    signature: sign(account, oneTimeKeyMessage(deviceId, keyId, key)),
  }));
}

export function markKeysAsPublished(account: OlmAccount): void {
  account.mark_keys_as_published();
}

/** Cuántas claves de un solo uso admite la cuenta; el cliente repone hasta ahí. */
export async function oneTimeKeyCapacity(): Promise<number> {
  await init();
  const { Account } = await lib();
  const probe = new Account();
  probe.create();
  const max = probe.max_number_of_one_time_keys();
  probe.free();
  return max;
}

/** Lo que el cliente recuerda de un dispositivo que ya vio. */
export type PinnedDevice = { identityKey: string; signingKey: string };

/**
 * Comprueba que un paquete servido por el servidor es del dispositivo que dice.
 *
 * Con `pinned` se exige **el par completo** —identidad y firma— y las firmas se
 * verifican contra la clave fijada, no contra la que llega en el paquete. Es
 * imprescindible: la firma del paquete se comprueba con la `signingKey` que el
 * propio paquete trae, así que sin anclar esa clave el servidor puede quedarse
 * con la identidad de la persona, poner una de firma suya, firmarse su propio
 * paquete y la comprobación pasaría. Sin el anclaje, una firma válida solo
 * demuestra que alguien tiene *una* clave privada.
 */
export async function verifyBundle(bundle: DeviceBundle, pinned?: PinnedDevice): Promise<void> {
  if (
    pinned &&
    (bundle.identityKey !== pinned.identityKey || bundle.signingKey !== pinned.signingKey)
  ) {
    throw new Error("El paquete del dispositivo no es el que se conocía.");
  }
  const trust = pinned?.signingKey ?? bundle.signingKey;
  const bundleOk = await verifySignature(
    trust,
    bundleMessage(bundle.deviceId, bundle.identityKey, bundle.signingKey),
    bundle.signature,
  );
  if (!bundleOk) throw new Error("El paquete del dispositivo no está firmado por su clave.");
  const keyOk = await verifySignature(
    trust,
    oneTimeKeyMessage(bundle.deviceId, bundle.oneTimeKey.keyId, bundle.oneTimeKey.key),
    bundle.oneTimeKey.signature,
  );
  if (!keyOk) throw new Error("La clave de un solo uso no la firmó el dispositivo.");
}

/**
 * Abre una sesión saliente contra el paquete de un dispositivo.
 *
 * El primer mensaje que se cifre con la sesión sale como `type` 0 y lleva lo
 * necesario para que la otra parte construya su lado. La clave de un solo uso
 * la ha entregado el servidor y no se reutiliza.
 */
export async function startSession(account: OlmAccount, bundle: DeviceBundle): Promise<OlmSession> {
  await init();
  const { Session } = await lib();
  const session = new Session();
  session.create_outbound(account, bundle.identityKey, bundle.oneTimeKey.key);
  return session;
}

/**
 * Como `startSession`, pero no abre nada si el paquete no está bien firmado.
 *
 * Es el camino que debe usar el cliente: el servidor entrega el paquete y el
 * cliente decide si se fía.
 */
export async function startVerifiedSession(
  account: OlmAccount,
  bundle: DeviceBundle,
  pinned?: PinnedDevice,
): Promise<OlmSession> {
  await verifyBundle(bundle, pinned);
  return startSession(account, bundle);
}

/**
 * Acepta una sesión entrante a partir de un mensaje de pre-clave.
 *
 * Consume la clave de un solo uso en la cuenta: sin esto, el mismo mensaje
 * podría reabrir la sesión indefinidamente.
 */
export async function acceptSession(
  account: OlmAccount,
  senderIdentityKey: string,
  prekey: Envelope,
): Promise<OlmSession> {
  await init();
  if (prekey.type !== 0) throw new Error("Un mensaje de pre-clave debe ser de tipo 0.");
  const { Session } = await lib();
  const session = new Session();
  session.create_inbound_from(account, senderIdentityKey, prekey.body);
  account.remove_one_time_keys(session);
  return session;
}

/**
 * Texto en claro del sobre: hilo y mensaje, rellenado a bloques de 256.
 *
 * El relleno es lo que impide deducir la longitud del mensaje del tamaño del
 * cifrado; el hilo va **dentro** porque libolm no acepta datos asociados, y sin
 * él un servidor hostil podría mover un cifrado a otra conversación con la
 * misma persona y el cliente lo mostraría allí como si fuera de ese hilo.
 */
function seal(content: MessageContent): string {
  const json = JSON.stringify({ v: 2, c: content.conversation, t: content.text });
  // En **bytes**, no en unidades UTF-16: un mensaje en castellano o alemán ocupa
  // más bytes que caracteres, y libolm cifra bytes. Contando caracteres, el
  // bloque no era de 256 bytes y el tamaño delataba algo más de la cuenta.
  const bytes = new TextEncoder().encode(json).length;
  const size = Math.ceil((bytes + 1) / PADDING_BLOCK) * PADDING_BLOCK;
  return json + " ".repeat(size - bytes);
}

function unseal(plaintext: string, conversation: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error("El mensaje no tiene el formato del protocolo v2.");
  }
  const envelope = parsed as { v?: unknown; c?: unknown; t?: unknown } | null;
  if (!envelope || envelope.v !== 2 || typeof envelope.c !== "string" || typeof envelope.t !== "string") {
    throw new Error("El mensaje no tiene el formato del protocolo v2.");
  }
  if (envelope.c !== conversation) {
    throw new Error("El mensaje pertenece a otra conversación.");
  }
  return envelope.t;
}

/** Cifra con una sesión establecida (el primero sale como pre-clave). */
export function encrypt(session: OlmSession, content: MessageContent): Envelope {
  const message = session.encrypt(seal(content));
  return { type: message.type, body: message.body };
}

/**
 * Descifra un mensaje y comprueba que es de la conversación esperada. Lanza si
 * el MAC falla, si el mensaje se repite, si la sesión no corresponde o si el
 * hilo no es el que se pidió: no hay ningún camino que devuelva texto a medias.
 */
export function decrypt(session: OlmSession, message: Envelope, conversation: string): string {
  return unseal(session.decrypt(message.type, message.body), conversation);
}

/** Identificador de sesión: las dos partes ven el mismo. */
export function sessionId(session: OlmSession): string {
  return session.session_id();
}

/** Olvida la sesión y su material: después nada de esa sesión se descifra. */
export function forgetSession(session: OlmSession): void {
  session.free();
}

/**
 * Serializa la cuenta para guardarla en el dispositivo.
 *
 * `key` es un secreto local que no viaja al servidor; sin él el bote no se abre.
 */
export function pickleAccount(account: OlmAccount, key: string): string {
  return account.pickle(key);
}

export async function unpickleAccount(pickle: string, key: string): Promise<OlmAccount> {
  await init();
  const account = new (await lib()).Account();
  account.unpickle(key, pickle);
  return account;
}

export function pickleSession(session: OlmSession, key: string): string {
  return session.pickle(key);
}

export async function unpickleSession(pickle: string, key: string): Promise<OlmSession> {
  await init();
  const { Session } = await lib();
  const session = new Session();
  session.unpickle(key, pickle);
  return session;
}
