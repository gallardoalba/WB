"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Lock, MapPin, MessageCircle, Send, Star, TriangleAlert } from "lucide-react";
import { Dialog } from "../dialog";
import { HandoverCode } from "../handover-code";
import { api } from "@/lib/client-api";
import {
  REPORT_REASONS,
  REQUEST_STATUS_LABELS,
  type MessageView,
  type PublicKeyView,
  type RequestView,
} from "@/lib/domain";
import {
  decryptMessage,
  deriveConversationKey,
  encryptMessage,
  ensureIdentity,
  isEncryptionSupported,
  messageAad,
} from "@/lib/e2e";
import { officesForCity } from "@/lib/post-offices";
import { allowedTargets } from "@/lib/request-flow";
import type { MessageKey } from "@/lib/i18n";
import { formatWhen } from "@/lib/text";
import { useI18n } from "../i18n-provider";
import { ACTION_LABELS, type BaseDialogProps } from "./shared";

const EXCHANGE_STEPS = ["Solicitado", "Aceptado", "Entrega", "Valoración"] as const;

const CONFIRM_STATUS_TEXT: Record<string, MessageKey> = {
  accepted: "Al aceptar se reserva el ejemplar y se cierran las demás solicitudes pendientes.",
  declined: "Se rechaza esta solicitud. La persona podrá volver a pedir otro ejemplar.",
  cancelled: "Se cancela el intercambio y el ejemplar vuelve a estar disponible.",
  completed: "Confirmas que la entrega se ha hecho. Si la otra parte ya confirmó, el intercambio se cierra.",
};

type ThreadPayload = {
  messages: MessageView[];
  hasMore: boolean;
  keys: { me: PublicKeyView; peer: PublicKeyView };
};
type Conversation = {
  requestId: string;
  messages: MessageView[];
  key: CryptoKey | null;
  decoded: Record<string, string>;
  peerReady: boolean;
  me: PublicKeyView;
  peer: PublicKeyView;
  /** La huella guardada de la otra persona no coincide con la actual. */
  keyChanged: boolean;
};

function sameKey(stored: JsonWebKey | null, own: JsonWebKey): boolean {
  return Boolean(
    stored && stored.x === own.x && stored.y === own.y && stored.crv === own.crv,
  );
}

function pinStorageKey(userId: string): string {
  return `b2p-key-pin:${userId}`;
}

function shortFingerprint(keyId: string | null): string {
  if (!keyId) return "sin clave";
  return keyId.slice(0, 4).toUpperCase() + " " + keyId.slice(4, 8).toUpperCase();
}

export function ExchangeDialog({
  open,
  onClose,
  request,
  onChanged,
}: BaseDialogProps & { request: RequestView | null; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const [thread, setThread] = useState<Conversation | null>(null);
  const [error, setError] = useState("");
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [incidentFeedback, setIncidentFeedback] = useState("");
  const [incidentError, setIncidentError] = useState("");
  const [incidentBusy, setIncidentBusy] = useState(false);
  const [changingOffice, setChangingOffice] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [reviewSending, setReviewSending] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const lastSeenMessage = useRef<string | null>(null);
  const requestId = request?.id ?? null;

  // Oficinas de Deutsche Post cercanas a las dos partes. El punto de entrega
  // siempre es un local público: nunca una dirección privada.
  const officeOptions = useMemo(() => {
    if (!request) return [];
    const merged = new Map<string, { id: string; label: string; km: number }>();
    for (const city of [request.owner.city, request.requester.city]) {
      for (const office of officesForCity(city, 3)) {
        const current = merged.get(office.id);
        if (!current || office.distanceKm < current.km) {
          const address = [office.street, [office.postalCode, office.locality].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(", ");
          merged.set(office.id, {
            id: office.id,
            label: `${office.name}${address ? ` · ${address}` : ""} (${office.distanceKm} km de ${city})`,
            km: office.distanceKm,
          });
        }
      }
    }
    return [...merged.values()].sort((a, b) => a.km - b.km);
  }, [request]);

  function close() {
    setError("");
    onClose();
  }

  async function prepareConversation(
    payload: ThreadPayload,
    conversationId: string,
  ): Promise<Omit<Conversation, "requestId" | "messages">> {
    const peerJwk = payload.keys.peer.publicJwk;
    const me: PublicKeyView = { ...payload.keys.me };
    const peer: PublicKeyView = { ...payload.keys.peer };
    if (!peerJwk || !isEncryptionSupported()) {
      return { key: null, decoded: {}, peerReady: Boolean(peerJwk), me, peer, keyChanged: false };
    }
    const identity = await ensureIdentity();
    me.keyId = identity.keyId;
    me.publicJwk = identity.publicJwk;
    if (
      payload.keys.me.keyId !== identity.keyId ||
      !sameKey(payload.keys.me.publicJwk, identity.publicJwk)
    ) {
      await api("/api/account/keys", { method: "PUT", body: identity.publicJwk });
    }

    // TOFU: la primera huella que veamos se recuerda; si cambia, se avisa y no
    // se permite enviar hasta que la persona lo confirme.
    let keyChanged = false;
    if (peer.keyId) {
      const pinned = localStorage.getItem(pinStorageKey(peer.id));
      if (!pinned) localStorage.setItem(pinStorageKey(peer.id), peer.keyId);
      else keyChanged = pinned !== peer.keyId;
    }

    const key = await deriveConversationKey(identity.privateKey, peerJwk, conversationId);
    const decoded: Record<string, string> = {};
    await Promise.all(
      payload.messages
        .filter((message) => message.encrypted && message.ciphertext && message.iv)
        .map(async (message) => {
          const aad = message.keyId
            ? messageAad(conversationId, message.sender.id, message.keyId)
            : undefined;
          const text = await decryptMessage(
            key,
            {
              ciphertext: message.ciphertext as string,
              iv: message.iv as string,
            },
            aad,
          );
          if (text !== null) decoded[message.id] = text;
        }),
    );
    return { key, decoded, peerReady: true, me, peer, keyChanged };
  }

  // Mensajería en vivo: el servidor solo avisa de que hay novedades (sin
  // contenido); el refetch y el descifrado ocurren en este dispositivo.
  useEffect(() => {
    if (!open || !requestId || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/requests/${requestId}/events`);
    source.addEventListener("messages", () => setRefreshTick((tick) => tick + 1));
    return () => source.close();
  }, [open, requestId]);

  useEffect(() => {
    if (!open || !requestId) return;
    let cancelled = false;
    api<ThreadPayload>(`/api/requests/${requestId}/messages`)
      .then(async (data) => {
        let prepared: Omit<Conversation, "requestId" | "messages"> = {
          key: null,
          decoded: {},
          peerReady: false,
          me: data.keys.me,
          peer: data.keys.peer,
          keyChanged: false,
        };
        try {
          prepared = await prepareConversation(data, requestId);
        } catch (caught) {
          if (!cancelled) {
            setError(
              caught instanceof Error
                ? caught.message
                : t("No se pudo preparar el cifrado de la conversación."),
            );
          }
        }
        if (cancelled) return;
        setThread({ requestId, messages: data.messages, ...prepared });
        setHasOlder(data.hasMore);

        // Solo se anuncia lo que llega de la otra parte (no el historial):
        // la región viva dedicada evita re-leer todo el hilo.
        const newest = data.messages[data.messages.length - 1];
        if (newest) {
          if (lastSeenMessage.current === null) {
            lastSeenMessage.current = newest.id;
          } else if (newest.id !== lastSeenMessage.current) {
            lastSeenMessage.current = newest.id;
            if (newest.sender.id !== data.keys.me.id) {
              setAnnouncement(
                t("{name} ha enviado un mensaje.", { name: newest.sender.name }),
              );
            }
          }
        }
        // Marcar como leída es una mutación explícita (ya no ocurre en el GET).
        void api(`/api/requests/${requestId}/read`, { method: "POST" })
          .then(() => onChanged())
          .catch(() => undefined);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t("No se pudo cargar."));
      });
    return () => {
      cancelled = true;
    };
  }, [open, requestId, onChanged, refreshTick, t]);

  async function loadOlder() {
    if (!requestId || messages.length === 0) return;
    setLoadingOlder(true);
    setError("");
    try {
      const data = await api<ThreadPayload>(
        `/api/requests/${requestId}/messages?before=${encodeURIComponent(messages[0]!.id)}`,
      );
      const prepared = thread
        ? {
            key: thread.key,
            decoded: thread.decoded,
            peerReady: thread.peerReady,
            me: thread.me,
            peer: thread.peer,
            keyChanged: thread.keyChanged,
          }
        : {
            key: null,
            decoded: {},
            peerReady: false,
            me: data.keys.me,
            peer: data.keys.peer,
            keyChanged: false,
          };
      const decoded = { ...prepared.decoded };
      if (prepared.key) {
        await Promise.all(
          data.messages
            .filter((message) => message.encrypted && message.ciphertext && message.iv)
            .map(async (message) => {
              const aad = message.keyId
                ? messageAad(requestId, message.sender.id, message.keyId)
                : undefined;
              const text = await decryptMessage(
                prepared.key as CryptoKey,
                {
                  ciphertext: message.ciphertext as string,
                  iv: message.iv as string,
                },
                aad,
              );
              if (text !== null) decoded[message.id] = text;
            }),
        );
      }
      setThread({
        requestId,
        messages: [...data.messages, ...messages],
        ...prepared,
        decoded,
      });
      setHasOlder(data.hasMore);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudieron cargar los mensajes."));
    } finally {
      setLoadingOlder(false);
    }
  }

  if (!request) return null;

  const messages = thread?.requestId === requestId ? thread.messages : [];
  const loading = !error && thread?.requestId !== requestId;
  const actions = allowedTargets(request.role, request.status).filter(
    (target) =>
      !(target === "completed" && request.confirmedByMe) &&
      !(target === "completed" && request.role === "requester" && request.handoverCodeRequired),
  );

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const body = String(formData.get("body") ?? "").trim();
    if (!body || !requestId) return;
    if (!thread?.key || !thread.me.keyId) {
      setError(t("Falta la clave de cifrado de la conversación. Vuelve a abrir el intercambio."));
      return;
    }
    if (thread.keyChanged) {
      setError(t("La clave de la otra persona ha cambiado. Confírmala antes de enviar."));
      return;
    }
    setSending(true);
    setError("");
    try {
      const envelope = await encryptMessage(
        thread.key,
        body,
        messageAad(requestId, thread.me.id, thread.me.keyId),
      );
      const data = await api<{ message: MessageView }>(`/api/requests/${requestId}/messages`, {
        method: "POST",
        body: { ...envelope, keyId: thread.me.keyId },
      });
      setThread({
        ...thread,
        messages: [...messages, data.message],
        decoded: { ...thread.decoded, [data.message.id]: body },
      });
      form.reset();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo enviar el mensaje."));
    } finally {
      setSending(false);
    }
  }

  function trustPeerKey() {
    if (!thread?.peer.keyId) return;
    localStorage.setItem(pinStorageKey(thread.peer.id), thread.peer.keyId);
    setThread({ ...thread, keyChanged: false });
  }

  async function reportMessage(messageId: string) {
    if (reportDetails.trim().length < 10) {
      setError(t("Describe qué ha pasado: la moderación no puede leer los mensajes cifrados."));
      return;
    }
    setReportBusy(true);
    setError("");
    try {
      await api("/api/reports", {
        method: "POST",
        body: {
          targetType: "message",
          targetId: messageId,
          reason: "Comportamiento abusivo",
          details: reportDetails.trim(),
        },
      });
      setReportTarget(null);
      setReportDetails("");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo enviar la denuncia."));
    } finally {
      setReportBusy(false);
    }
  }

  async function reportIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestId) return;
    const form = new FormData(event.currentTarget);
    const details = String(form.get("details") ?? "").trim();
    if (details.length < 10) {
      setIncidentError(t("Describe qué ha pasado para que la moderación pueda revisar la incidencia."));
      return;
    }
    setIncidentBusy(true);
    setIncidentError("");
    setIncidentFeedback("");
    try {
      await api("/api/reports", {
        method: "POST",
        body: {
          targetType: "request",
          targetId: requestId,
          reason: form.get("reason"),
          details,
        },
      });
      setIncidentFeedback(t("Incidencia enviada. La moderación la revisará."));
    } catch (caught) {
      setIncidentError(caught instanceof Error ? caught.message : t("No se pudo enviar la incidencia."));
    } finally {
      setIncidentBusy(false);
    }
  }

  async function applyStatus(status: string) {
    if (!requestId) return;
    setBusy(true);
    setError("");
    try {
      const body: { status: string; officeId?: string | null } = { status };
      if (status === "accepted" && request) {
        // Se propone la oficina más cercana a quien entrega el libro.
        body.officeId = officesForCity(request.owner.city, 1)[0]?.id ?? null;
      }
      await api(`/api/requests/${requestId}`, { method: "PATCH", body });
      setConfirmStatus(null);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo actualizar."));
    } finally {
      setBusy(false);
    }
  }

  async function changeOffice(officeId: string) {
    if (!requestId) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/requests/${requestId}/handover`, {
        method: "PATCH",
        body: { officeId },
      });
      setChangingOffice(false);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo cambiar el punto de entrega."));
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestId) return;
    if (!rating) {
      setReviewError(t("Elige una puntuación"));
      return;
    }
    setReviewSending(true);
    setReviewError("");
    try {
      await api(`/api/requests/${requestId}/review`, {
        method: "POST",
        body: { rating: Number(rating), comment: reviewComment },
      });
      onChanged();
    } catch (caught) {
      setReviewError(
        caught instanceof Error ? caught.message : t("No se pudo enviar la valoración."),
      );
    } finally {
      setReviewSending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title={request.listing.title}
      description={`${request.role === "owner" ? t("Solicitud de {name}", { name: request.requester.name }) : t("Solicitado a {name}", { name: request.owner.name })} · ${t("Estado:")} ${t(REQUEST_STATUS_LABELS[request.status])}`}
      overline={t("INTERCAMBIO")}
      icon={<MessageCircle size={20} />}
    >
      {actions.length > 0 && (
        <div className="exchange-actions">
          {actions.map((status) => (
            <button
              key={status}
              type="button"
              className={status === "accepted" || status === "completed" ? "share-button small" : "secondary-button small"}
              disabled={busy}
              onClick={() => setConfirmStatus(status)}
            >
              {status === "completed" ? t("Confirmar entrega") : t(ACTION_LABELS[status] ?? status)}
            </button>
          ))}
        </div>
      )}

      {confirmStatus && (
        <div className="exchange-confirm" role="group" aria-label={t("CONFIRMAR ACCIÓN")}>
          <p role="alert">{t(CONFIRM_STATUS_TEXT[confirmStatus] ?? "¿Confirmas esta acción?")}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button small"
              onClick={() => setConfirmStatus(null)}
              disabled={busy}
            >
              {t("Cancelar")}
            </button>
            <button
              type="button"
              className="share-button small"
              onClick={() => void applyStatus(confirmStatus)}
              disabled={busy}
            >
              {t("Confirmar")}
            </button>
          </div>
        </div>
      )}

      {request.status === "accepted" && request.confirmedByMe && (
        <p className="form-note" role="status">
          {t("Has confirmado la entrega. El intercambio se cerrará cuando la otra persona también la confirme.")}
        </p>
      )}

      <div className="exchange-steps" aria-label={t("Estado del intercambio")}>
        {EXCHANGE_STEPS.map((step, index) => {
          const completed = request.status === "completed" ? 3 : request.status === "accepted" ? 2 : 1;
          const reached =
            index < completed || (index === completed && request.status === "completed" && request.reviewed);
          const current =
            (request.status === "pending" && index === 0) ||
            (request.status === "accepted" && index === 2) ||
            (request.status === "completed" && index === 3 && !request.reviewed);
          return (
            <span
              key={step}
              className={
                reached || (index === completed && request.status === "completed" && request.reviewed)
                  ? "exchange-step done"
                  : current
                    ? "exchange-step current"
                    : "exchange-step"
              }
              aria-current={current ? "step" : undefined}
            >
              <i>{index + 1}</i>
              {t(step)}
            </span>
          );
        })}
      </div>

      <div className="handover-card">
        <MapPin size={16} aria-hidden />
        <div>
          <strong>{t("Punto de entrega")}</strong>
          {request.delivery.pickupPoint ? (
            <p>
              {request.delivery.pickupPoint.name} ·{" "}
              {[
                request.delivery.pickupPoint.street,
                [
                  request.delivery.pickupPoint.postalCode,
                  request.delivery.pickupPoint.city,
                ]
                  .filter(Boolean)
                  .join(" "),
              ]
                .filter(Boolean)
                .join(", ")}
            </p>
          ) : (
            <p>
              {request.status === "accepted" || request.status === "completed"
                ? t("Entrega en mano, sin oficina asignada.")
                : t("Se elige al aceptar el intercambio.")}
            </p>
          )}
          {(request.status === "accepted" || request.status === "completed") &&
            (officeOptions.length > 0 ? (
              <button
                type="button"
                className="message-report"
                onClick={() => setChangingOffice((value) => !value)}
                disabled={busy}
              >
                {changingOffice ? t("Cancelar") : t("Cambiar punto de entrega")}
              </button>
            ) : (
              <p className="form-hint">
                {t("No hay oficinas de Deutsche Post cerca: acordad el punto exacto en la conversación.")}
              </p>
            ))}
          {changingOffice && (
            <label className="handover-picker">
              <span>{t("Oficina de Deutsche Post")}</span>
              <select
                defaultValue={request.delivery.pickupPoint?.id ?? ""}
                disabled={busy || officeOptions.length === 0}
                onChange={(event) => {
                  if (event.target.value) void changeOffice(event.target.value);
                }}
              >
                {request.delivery.pickupPoint ? null : (
                  <option value="">{t("Elige una oficina…")}</option>
                )}
                {officeOptions.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.label}
                  </option>
                ))}
              </select>
              <small className="handover-attribution">
                {t("Direcciones de OpenStreetMap (ODbL). Confirma el horario en la web de Deutsche Post.")}
              </small>
            </label>
          )}
        </div>
      </div>

      {request.status === "accepted" && !request.confirmedByMe && (
        <HandoverCode
          requestId={request.id}
          code={request.handoverCode}
          required={request.handoverCodeRequired}
          onVerified={onChanged}
        />
      )}

      <p className="encryption-note">
        <Lock size={13} aria-hidden /> {t("Cifrado de extremo a extremo · Huella de")}{" "}
        {thread?.peer.name ?? t("la otra persona")}:{" "}
        <strong>{t(shortFingerprint(thread?.peer.keyId ?? null))}</strong>
      </p>

      <details className="exchange-help">
        <summary>{t("¿Cómo funciona el cifrado?")}</summary>
        <p>
          {t("La clave privada se guarda solo en este navegador y nunca se envía al servidor. En otro dispositivo no se podrán leer los mensajes anteriores. Si cambias de dispositivo, pide a la otra persona que vuelva a escribirte desde el suyo.")}
        </p>
      </details>

      {thread?.keyChanged && (
        <div className="key-warning" role="alert">
          <p>
            {t("La clave de {name} ha cambiado. Podría ser un dispositivo nuevo o alguien intentando leer la conversación. Verifica la huella con la otra persona antes de continuar.", { name: thread.peer.name })}
          </p>
          <button type="button" className="secondary-button small" onClick={trustPeerKey}>
            {t("Confío en esta clave")}
          </button>
        </div>
      )}

      {/* Solo se anuncia el mensaje nuevo: el hilo entero como región viva
          re-leía todo el historial en cada actualización. */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <div className="message-thread">
        {loading && <p className="empty-note">{t("Cargando conversación…")}</p>}
        {hasOlder && !loading && (
          <button
            type="button"
            className="secondary-button small load-more"
            onClick={loadOlder}
            disabled={loadingOlder}
          >
            {loadingOlder ? t("Cargando…") : t("Ver mensajes anteriores")}
          </button>
        )}
        {!loading && messages.length === 0 && (
          <p className="empty-note">{t("Todavía no hay mensajes. Escribe el primero para coordinar la entrega.")}</p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={message.isMine ? "message mine" : "message"}>
            <span className="message-author">
              {message.sender.name} · {formatWhen(message.createdAt, locale)}
            </span>
            {message.encrypted ? (
              <p>
                {thread?.decoded[message.id] ??
                  t("No se puede descifrar en este dispositivo (la clave privada solo existe en el navegador donde se activó).")}
              </p>
            ) : (
              <p>
                {message.body}{" "}
                <span className="plaintext-badge">{t("Sin cifrar (histórico)")}</span>
              </p>
            )}
            {!message.isMine && reportTarget !== message.id && (
              <button
                type="button"
                className="message-report"
                onClick={() => {
                  setReportTarget(message.id);
                  setReportDetails("");
                  setError("");
                }}
              >
                {t("Denunciar")}
              </button>
            )}
            {reportTarget === message.id && (
              <div className="message-report-form">
                <label htmlFor={`report-${message.id}`}>
                  {t("¿Qué ocurre? La moderación no puede leer los mensajes cifrados.")}
                </label>
                <textarea
                  id={`report-${message.id}`}
                  rows={2}
                  maxLength={500}
                  minLength={10}
                  required
                  value={reportDetails}
                  onChange={(event) => setReportDetails(event.target.value)}
                />
                <div className="message-report-actions">
                  <button
                    type="button"
                    className="secondary-button small"
                    onClick={() => {
                      setReportTarget(null);
                      setReportDetails("");
                    }}
                  >
                    {t("Cancelar")}
                  </button>
                  <button
                    type="button"
                    className="share-button small"
                    disabled={reportBusy}
                    onClick={() => void reportMessage(message.id)}
                  >
                    {reportBusy ? t("Enviando…") : t("Enviar denuncia")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !thread?.key && (
        <p className="form-note" role="status">
          {isEncryptionSupported()
            ? t("La otra persona todavía no ha activado el cifrado en su dispositivo. Podréis escribir en cuanto abra la aplicación una vez.")
            : t("Tu navegador no permite el cifrado de extremo a extremo.")}
        </p>
      )}

      <form className="message-form" onSubmit={send}>
        <label className="sr-only" htmlFor="message-body">
          {t("Escribe un mensaje")}
        </label>
        <input
          id="message-body"
          name="body"
          maxLength={800}
          placeholder={
            thread?.key && !thread.keyChanged
              ? t("Escribe un mensaje…")
              : t("Mensajes cifrados no disponibles")
          }
          autoComplete="off"
          disabled={!thread?.key || thread.keyChanged || sending}
        />
        <button
          className="share-button small"
          type="submit"
          disabled={!thread?.key || thread.keyChanged || sending}
          aria-label={t("Enviar mensaje")}
        >
          <Send size={15} />
        </button>
      </form>

      {request.status !== "pending" && (
        <details className="report-box incident-box">
          <summary>
            <TriangleAlert size={14} /> {t("Problema con este intercambio")}
          </summary>
          <form onSubmit={reportIncident}>
            <p className="form-note">
              {t("Cuéntanos qué ha pasado. La moderación no puede leer los mensajes cifrados.")}
            </p>
            <label htmlFor="incident-reason">{t("Motivo")}</label>
            <select id="incident-reason" name="reason" defaultValue={REPORT_REASONS[0]}>
              {REPORT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {t(reason)}
                </option>
              ))}
            </select>
            <label htmlFor="incident-details">{t("Qué ha pasado")}</label>
            <textarea id="incident-details" name="details" rows={3} minLength={10} maxLength={500} required />
            {incidentFeedback && (
              <p className="action-feedback" role="status">
                {incidentFeedback}
              </p>
            )}
            {incidentError && (
              <p className="form-error" role="alert">
                {incidentError}
              </p>
            )}
            <button type="submit" className="secondary-button small" disabled={incidentBusy}>
              {incidentBusy ? t("Enviando…") : t("Enviar incidencia")}
            </button>
          </form>
        </details>
      )}

      {request.status === "completed" && request.reviewed && (
        <p className="action-feedback">
          <Star size={14} /> {t("Ya has valorado este intercambio.")}
        </p>
      )}

      {request.status === "completed" && !request.reviewed && (
        <form className="review-form" onSubmit={submitReview}>
          <strong>{t("¿Cómo fue el intercambio?")}</strong>
          <div className="review-row">
            <label htmlFor="review-rating">{t("Puntuación")}</label>
            <select
              id="review-rating"
              value={rating}
              required
              onChange={(event) => setRating(event.target.value)}
            >
              <option value="" disabled>
                {t("Elige una puntuación")}
              </option>
              {[5, 4, 3, 2, 1].map((value) => (
                <option key={value} value={value}>
                  {t("{n} de 5", { n: value })}
                </option>
              ))}
            </select>
          </div>
          <label htmlFor="review-comment">{t("Comentario (opcional)")}</label>
          <textarea
            id="review-comment"
            rows={2}
            maxLength={500}
            value={reviewComment}
            onChange={(event) => setReviewComment(event.target.value)}
          />
          {reviewError && (
            <p className="form-error" role="alert">
              {reviewError}
            </p>
          )}
          <button className="share-button small" type="submit" disabled={reviewSending}>
            {reviewSending ? t("Enviando…") : t("Enviar valoración")}
          </button>
        </form>
      )}
    </Dialog>
  );
}

