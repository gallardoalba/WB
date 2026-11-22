"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { Lock, Send, TriangleAlert } from "lucide-react";
import { Dialog } from "./dialog";
import { api } from "@/lib/client-api";
import type { DirectThreadView } from "@/lib/domain";
import {
  decryptForThread,
  directAad,
  encryptForRecipients,
  ensureIdentity,
  isEncryptionSupported,
  safetyNumber,
  type RecipientKey,
} from "@/lib/e2e";
import { formatWhen } from "@/lib/text";
import { useI18n } from "./i18n-provider";

/**
 * Las dos partes derivan la misma clave a partir del par de identificadores
 * ordenado, así que la conversación se puede cifrar antes de que exista la fila
 * en la base de datos (el primer mensaje la crea).
 */
export function directConversationId(a: string, b: string): string {
  return `dm:${[a, b].sort().join(":")}`;
}

function shortFingerprint(keyId: string | null): string {
  if (!keyId) return "sin clave";
  return keyId.slice(0, 4).toUpperCase() + " " + keyId.slice(4, 8).toUpperCase();
}

type Prepared = {
  payload: DirectThreadView;
  privateKey: CryptoKey | null;
  myKeyId: string | null;
  peerKeys: RecipientKey[];
  texts: Record<string, string>;
  /** Este navegador no tiene publicada su clave en la ranura web. */
  keyChanged: boolean;
  /** Huella que las dos partes pueden comparar por otro canal. */
  safety: string | null;
};

/** Claves de la otra persona; admite un servidor anterior a la v40. */
function peerEntries(peer: DirectThreadView["peer"]): RecipientKey[] {
  if (peer.keys && peer.keys.length > 0) {
    return peer.keys.map((key) => ({ keyId: key.keyId, publicJwk: key.publicJwk }));
  }
  if (peer.keyId && peer.keyJwk) {
    return [{ keyId: peer.keyId, publicJwk: peer.keyJwk }];
  }
  return [];
}

/**
 * El protocolo v2 se carga aparte: arrastra libolm (WASM) y solo hace falta
 * cuando este navegador tiene ya su dispositivo. Sin él, el hilo funciona con
 * v1 exactamente igual que antes.
 */
let v2Module: Promise<typeof import("@/lib/e2e-v2-chat") | null> | null = null;
async function getV2(): Promise<typeof import("@/lib/e2e-v2-chat") | null> {
  v2Module ??= import("@/lib/e2e-v2-chat").catch(() => null);
  const bridge = await v2Module;
  return bridge && bridge.v2Supported() ? bridge : null;
}

/**
 * Trae el hilo y lo descifra en este navegador. Si la cuenta todavía no tiene
 * clave publicada se publica la de este navegador y se vuelve a pedir el hilo;
 * si ya hay otra distinta no se puede sustituir sin la contraseña y se avisa.
 */
async function fetchThread(peerId: string, mayPublish: boolean): Promise<Prepared> {
  const payload = await api<DirectThreadView>(`/api/direct/${peerId}`);
  const peerKeys = peerEntries(payload.peer);
  if (peerKeys.length === 0 || !isEncryptionSupported()) {
    return {
      payload,
      privateKey: null,
      myKeyId: null,
      peerKeys,
      texts: {},
      keyChanged: false,
      safety: null,
    };
  }
  const serverKeys = payload.me.keys ?? [];
  const webSlot = serverKeys.find((key) => key.platform === "web") ?? null;
  const identity = await ensureIdentity(payload.me.id, {
    publishedKeyId: webSlot?.keyId ?? null,
  });
  if (!webSlot && mayPublish) {
    // Primera clave del navegador: se publica sola (TOFU). Si la cuenta ya
    // cifra desde otro dispositivo, el servidor pide la contraseña (428) y no
    // se publica nada: se avisa para hacerlo desde «Mi cuenta».
    try {
      await api("/api/account/keys", {
        method: "PUT",
        body: { ...identity.publicJwk, platform: "web" },
      });
    } catch {
      return {
        payload,
        privateKey: null,
        myKeyId: null,
        peerKeys,
        texts: {},
        keyChanged: true,
        safety: null,
      };
    }
    return fetchThread(peerId, false);
  }
  if (webSlot && webSlot.keyId !== identity.keyId) {
    // Otra clave ocupa la ranura web: este navegador no puede leer sin
    // sustituirla, y eso exige la contraseña desde «Mi cuenta».
    return {
      payload,
      privateKey: null,
      myKeyId: null,
      peerKeys,
      texts: {},
      keyChanged: true,
      safety: null,
    };
  }
  const conversationId = directConversationId(payload.me.id, payload.peer.id);
  const meKeys = (payload.me.keys ?? []).map((key) => key.publicJwk);
  const safety = await safetyNumber([
    ...(meKeys.length > 0 ? meKeys : [identity.publicJwk]),
    ...peerKeys.map((key) => key.publicJwk),
  ]);
  const texts: Record<string, string> = {};
  await Promise.all(
    payload.messages.map(async (message) => {
      if (!message.encrypted) return;
      const text = await decryptForThread(
        identity.privateKey,
        identity.keyId,
        peerKeys,
        message,
        message.senderId,
        conversationId,
        (senderId, keyId) => directAad(conversationId, senderId, keyId),
      );
      if (text !== null) texts[message.id] = text;
    }),
  );

  // Mientras conviven los protocolos, un mensaje puede traer solo sobre v2.
  const v2Texts = await getV2()
    .then((bridge) =>
      bridge?.decryptV2({
        userId: payload.me.id,
        peerUserId: payload.peer.id,
        conversation: conversationId,
        messages: payload.messages.map((message) => ({
          id: message.id,
          senderDeviceId: message.keyId ?? "",
          envelopes: message.envelopes,
        })),
      }),
    )
    .catch(() => undefined);
  Object.assign(texts, v2Texts ?? {});

  return {
    payload,
    privateKey: identity.privateKey,
    myKeyId: identity.keyId,
    peerKeys,
    texts,
    keyChanged: false,
    safety,
  };
}

export function DirectMessageDialog({
  open,
  onClose,
  peerId,
  peerName,
}: {
  open: boolean;
  onClose: () => void;
  peerId: string;
  peerName: string;
}) {
  const { t, locale } = useI18n();
  const [thread, setThread] = useState<DirectThreadView | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  /**
   * Mensajes que están saliendo. Se pintan en el acto con su texto en claro y
   * desaparecen cuando el hilo real vuelve del servidor: cifrar y esperar la
   * respuesta tarda lo bastante como para que el silencio se lea como «no se
   * ha enviado».
   */
  const [envios, agregarEnvio] = useOptimistic<
    { id: string; texto: string; hora: string }[],
    { id: string; texto: string; hora: string }
  >([], (previos, envio) => [...previos, envio]);
  const [sending, startTransition] = useTransition();
  const [hasKey, setHasKey] = useState(false);
  const [keyChanged, setKeyChanged] = useState(false);
  const [safety, setSafety] = useState<string | null>(null);
  const privateKeyRef = useRef<CryptoKey | null>(null);
  const myKeyIdRef = useRef<string | null>(null);
  const peerKeysRef = useRef<RecipientKey[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    () =>
      fetchThread(peerId, true)
        .then(async (prepared) => {
          setThread(prepared.payload);
          privateKeyRef.current = prepared.privateKey;
          myKeyIdRef.current = prepared.myKeyId;
          peerKeysRef.current = prepared.peerKeys;
          setHasKey(Boolean(prepared.privateKey && prepared.peerKeys.length > 0));
          setKeyChanged(prepared.keyChanged);
          setSafety(prepared.safety);
          setTexts(prepared.texts);
          if (prepared.payload.messages.length > 0) {
            await api(`/api/direct/${peerId}/read`, { method: "POST" }).catch(() => undefined);
          }
        })
        .catch((caught: unknown) =>
          setError(
            caught instanceof Error ? caught.message : t("No se pudo abrir la conversación."),
          ),
        ),
    [peerId, t],
  );

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, thread?.messages.length, texts, envios.length]);

  // El error de la visita anterior no debería recibir a quien vuelve al
  // diálogo; el borrador sí se conserva.
  useLayoutEffect(() => {
    return () => setError("");
  }, []);

  function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !thread) return;
    const peerId = thread.peer.id;
    const meId = thread.me.id;
    const keyId = myKeyIdRef.current;
    const privateKey = privateKeyRef.current;
    setError("");
    // Dentro de una transición: así el mensaje optimista aparece ya y React lo
    // retira solo cuando llega el hilo de verdad (o al fallar).
    startTransition(async () => {
      agregarEnvio({ id: `envio-${Date.now()}`, texto: body, hora: new Date().toISOString() });
      try {
        const conversationId = directConversationId(meId, peerId);
        // Igual que en los intercambios: si la otra persona tiene dispositivo,
        // el mensaje va solo en v2 y no se manda la copia de v1, que usa una
        // clave estática y no tiene forward secrecy.
        const v2 = await getV2()
          .then((bridge) =>
            bridge?.encryptV2({
              userId: meId,
              peerUserId: peerId,
              conversation: conversationId,
              text: body,
            }),
          )
          .catch(() => null);

        let payload: Record<string, unknown>;
        if (v2) {
          payload = { v2 };
        } else {
          if (!privateKey || !keyId) {
            throw new Error(
              t("Falta la clave de cifrado de la conversación. Vuelve a abrir el intercambio."),
            );
          }
          const envelopes = await encryptForRecipients(
            privateKey,
            peerKeysRef.current,
            conversationId,
            body,
            directAad(conversationId, meId, keyId),
          );
          payload = { keyId, envelopes };
        }

        await api(`/api/direct/${peerId}`, { method: "POST", body: payload });
        setDraft("");
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("No se pudo enviar el mensaje."));
      }
    });
  }

  const loading = !thread && !error;
  const reason = thread && !thread.canMessage ? thread.reason : null;
  const ready = Boolean(thread?.canMessage && hasKey);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={peerName}
      overline={t("Mensajes directos")}
      description={t("Solo vosotros dos podéis leer esta conversación.")}
      icon={<Lock size={18} />}
      wide
    >
      <div className="dm-dialog">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {reason === "mutual" && (
          <p className="dm-reason">
            <TriangleAlert size={14} aria-hidden />{" "}
            {t("Solo puedes escribir a lectores que también te siguen. Sigue a {name} y espera a que te siga de vuelta.", {
              name: peerName,
            })}
          </p>
        )}
        {reason === "no-key" && (
          <p className="dm-reason">
            <TriangleAlert size={14} aria-hidden />{" "}
            {t("{name} todavía no ha activado el cifrado en su navegador, así que no se puede abrir una conversación privada.", {
              name: peerName,
            })}
          </p>
        )}
        {reason === "blocked" && (
          <p className="dm-reason">
            <TriangleAlert size={14} aria-hidden />{" "}
            {t("No es posible abrir esta conversación.")}
          </p>
        )}

        {loading && <p className="dm-empty">{t("Abriendo la conversación…")}</p>}

        {keyChanged && (
          <div className="key-warning" role="alert">
            <p>
              {t(
                "Este navegador no puede leer ni escribir esta conversación: su clave no está publicada en tu cuenta o hay otra en su lugar. Publícala desde «Mi cuenta», que pedirá tu contraseña, para seguir.",
              )}
            </p>
            <a className="secondary-button small" href="/cuenta">
              {t("Ir a Mi cuenta")}
            </a>
          </div>
        )}

        {thread?.canMessage && (
          <>
            <ol className="dm-thread">
              {thread.messages.length === 0 && envios.length === 0 && (
                <li className="dm-empty">
                  {t("Aún no hay mensajes. Escribe el primero: se cifra en tu navegador antes de salir.")}
                </li>
              )}
              {thread.messages.map((message) => {
                const text = texts[message.id];
                return (
                  <li key={message.id} className={message.isMine ? "dm-line mine" : "dm-line"}>
                    <div className="dm-bubble">
                      {text ? (
                        <p>{text}</p>
                      ) : (
                        <p className="dm-unreadable">
                          <Lock size={13} aria-hidden />{" "}
                          {t("Mensaje cifrado con otra clave (se leyó en otro navegador).")}
                        </p>
                      )}
                      <time dateTime={message.createdAt}>{formatWhen(message.createdAt, locale)}</time>
                    </div>
                  </li>
                );
              })}
              {envios.map((envio) => (
                <li key={envio.id} className="dm-line mine dm-pending">
                  <div className="dm-bubble">
                    <p>{envio.texto}</p>
                    <time dateTime={envio.hora}>{t("Enviando…")}</time>
                  </div>
                </li>
              ))}
            </ol>
            <div ref={bottomRef} />

            <form className="dm-composer" onSubmit={send}>
              <label className="sr-only" htmlFor="dm-draft">
                {t("Escribe un mensaje")}
              </label>
              <textarea
                id="dm-draft"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={2}
                maxLength={2000}
                placeholder={t("Escribe un mensaje…")}
              />
              <button
                type="submit"
                className="primary-button small"
                disabled={sending || !draft.trim() || !ready}
              >
                <Send size={14} /> {t("Enviar")}
              </button>
            </form>

            <p className="encryption-note">
              <Lock size={13} aria-hidden /> {t("Cifrado de extremo a extremo · Huella de")}{" "}
              {peerName}: <strong>{t(shortFingerprint(thread.peer.keyId))}</strong>
            </p>

            {safety && (
              <details className="safety-number">
                <summary>{t("Huella de seguridad")}</summary>
                <p>
                  {t(
                    "Compárala con {name} por otro canal. Si cambia, alguien puede haberse interpuesto.",
                    { name: peerName },
                  )}
                </p>
                <code>{safety}</code>
              </details>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
