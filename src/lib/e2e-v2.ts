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
 * - Identidad por dispositivo, no por ranura de plataforma.
 *
 * Las claves privadas viven en el `Account` de libolm, que el cliente guarda
 * cifrado (`pickle`) en su propio almacén. El servidor solo ve el paquete
 * público.
 */
import Olm from "@matrix-org/olm";

type Lib = {
  init: (opts?: object) => Promise<void>;
  Account: new () => OlmAccount;
  Session: new () => OlmSession;
};

/** Los tipos publicados no exportan las clases; se declaran aquí. */
const lib = Olm as unknown as Lib;

export type OlmAccount = {
  create(): void;
  free(): void;
  identity_keys(): string;
  one_time_keys(): string;
  generate_one_time_keys(count: number): void;
  mark_keys_as_published(): void;
  remove_one_time_keys(session: OlmSession): void;
  max_number_of_one_time_keys(): number;
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

/** Paquete público de un dispositivo, tal y como se publica en el servidor. */
export type DeviceBundle = {
  deviceId: string;
  identityKey: string;
  signingKey: string;
  /** Clave de un solo uso reclamada; se gasta en el establecimiento. */
  oneTimeKey: string;
  oneTimeKeyId: string;
};

/**
 * Sobre de mensaje. `type` 0 es un mensaje de pre-clave: abre la sesión al
 * receptor. `type` 1 es un mensaje normal del ratchet.
 */
export type Envelope = { type: number; body: string };

const ONE_TIME_KEY_TARGET = 20;

let ready: Promise<void> | null = null;

/** Carga el WASM una sola vez por contexto. */
export function init(): Promise<void> {
  ready ??= lib.init();
  return ready;
}

/** Cuenta de dispositivo nueva, con claves de un solo uso ya generadas. */
export async function createAccount(oneTimeKeys = ONE_TIME_KEY_TARGET): Promise<OlmAccount> {
  await init();
  const account = new lib.Account();
  account.create();
  account.generate_one_time_keys(oneTimeKeys);
  return account;
}

export function identityKeys(account: OlmAccount): { identityKey: string; signingKey: string } {
  const keys = JSON.parse(account.identity_keys()) as { curve25519: string; ed25519: string };
  return { identityKey: keys.curve25519, signingKey: keys.ed25519 };
}

/**
 * Claves de un solo uso pendientes de publicar.
 *
 * `markKeysAsPublished` se llama **después** de que el servidor las acepte: si
 * la publicación falla se reintenta con las mismas y no se pierde ninguna.
 */
export function oneTimeKeys(account: OlmAccount): { keyId: string; key: string }[] {
  const keys = JSON.parse(account.one_time_keys()) as { curve25519?: Record<string, string> };
  return Object.entries(keys.curve25519 ?? {}).map(([keyId, key]) => ({ keyId, key }));
}

export function markKeysAsPublished(account: OlmAccount): void {
  account.mark_keys_as_published();
}

/** Cuántas claves de un solo uso admite la cuenta; el cliente repone hasta ahí. */
export async function oneTimeKeyCapacity(): Promise<number> {
  await init();
  const probe = new lib.Account();
  probe.create();
  const max = probe.max_number_of_one_time_keys();
  probe.free();
  return max;
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
  const session = new lib.Session();
  session.create_outbound(account, bundle.identityKey, bundle.oneTimeKey);
  return session;
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
  const session = new lib.Session();
  session.create_inbound_from(account, senderIdentityKey, prekey.body);
  account.remove_one_time_keys(session);
  return session;
}

/** Cifra con una sesión establecida (el primero sale como pre-clave). */
export function encrypt(session: OlmSession, plaintext: string): Envelope {
  const message = session.encrypt(plaintext);
  return { type: message.type, body: message.body };
}

/**
 * Descifra un mensaje. Lanza si el MAC falla, si el mensaje se repite o si la
 * sesión no corresponde: no hay ningún camino que devuelva texto a medias.
 */
export function decrypt(session: OlmSession, message: Envelope): string {
  return session.decrypt(message.type, message.body);
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
  const account = new lib.Account();
  account.unpickle(key, pickle);
  return account;
}

export function pickleSession(session: OlmSession, key: string): string {
  return session.pickle(key);
}

export async function unpickleSession(pickle: string, key: string): Promise<OlmSession> {
  await init();
  const session = new lib.Session();
  session.unpickle(key, pickle);
  return session;
}
