"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Lock, Send, TriangleAlert } from "lucide-react";
import { Dialog } from "./dialog";
import { api } from "@/lib/client-api";
import type { DirectThreadView } from "@/lib/domain";
import {
  decryptMessage,
  deriveConversationKey,
  directAad,
  encryptMessage,
  ensureIdentity,
  isEncryptionSupported,
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
  key: CryptoKey | null;
  texts: Record<string, string>;
  keyChanged: boolean;
};

/**
 * Trae el hilo y lo descifra en este navegador. Si la cuenta todavía no tiene
 * clave publicada se publica la de este navegador y se vuelve a pedir el hilo;
 * si ya hay otra distinta no se puede sustituir sin la contraseña y se avisa.
 */
async function fetchThread(peerId: string, mayPublish: boolean): Promise<Prepared> {
  const payload = await api<DirectThreadView>(`/api/direct/${peerId}`);
  const peerJwk = payload.peer.keyJwk;
  if (!peerJwk || !isEncryptionSupported()) {
    return { payload, key: null, texts: {}, keyChanged: false };
  }
  const identity = await ensureIdentity();
  if (payload.me.keyId === null && mayPublish) {
    await api("/api/account/keys", { method: "PUT", body: identity.publicJwk });
    return fetchThread(peerId, false);
  }
  if (payload.me.keyId !== identity.keyId) {
    return { payload, key: null, texts: {}, keyChanged: true };
  }
  const conversationId = directConversationId(payload.me.id, payload.peer.id);
  const key = await deriveConversationKey(identity.privateKey, peerJwk, conversationId);
  const texts: Record<string, string> = {};
  await Promise.all(
    payload.messages
      .filter((message) => message.encrypted && message.ciphertext && message.iv)
      .map(async (message) => {
        const aad = message.keyId
          ? directAad(conversationId, message.senderId, message.keyId)
          : undefined;
        const text = await decryptMessage(
          key,
          { ciphertext: message.ciphertext as string, iv: message.iv as string },
          aad,
        );
        if (text !== null) texts[message.id] = text;
      }),
  );
  return { payload, key, texts, keyChanged: false };
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
  const [sending, setSending] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [keyChanged, setKeyChanged] = useState(false);
  const keyRef = useRef<CryptoKey | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    () =>
      fetchThread(peerId, true)
        .then(async (prepared) => {
          setThread(prepared.payload);
          keyRef.current = prepared.key;
          setHasKey(Boolean(prepared.key));
          setKeyChanged(prepared.keyChanged);
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
  }, [open, thread?.messages.length, texts]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !thread || !keyRef.current) return;
    setSending(true);
    setError("");
    try {
      const identity = await ensureIdentity();
      const conversationId = directConversationId(thread.me.id, thread.peer.id);
      const envelope = await encryptMessage(
        keyRef.current,
        body,
        directAad(conversationId, thread.me.id, identity.keyId),
      );
      await api(`/api/direct/${thread.peer.id}`, {
        method: "POST",
        body: { ciphertext: envelope.ciphertext, iv: envelope.iv, keyId: identity.keyId },
      });
      setDraft("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo enviar el mensaje."));
    } finally {
      setSending(false);
    }
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
                "Este navegador tiene una clave distinta a la que está publicada en tu cuenta, así que no puede leer ni escribir esta conversación. Publica esta clave desde «Mi cuenta» para seguir.",
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
              {thread.messages.length === 0 && (
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
                className="share-button small"
                disabled={sending || !draft.trim() || !ready}
              >
                <Send size={14} /> {t("Enviar")}
              </button>
            </form>

            <p className="encryption-note">
              <Lock size={13} aria-hidden /> {t("Cifrado de extremo a extremo · Huella de")}{" "}
              {peerName}: <strong>{t(shortFingerprint(thread.peer.keyId))}</strong>
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
