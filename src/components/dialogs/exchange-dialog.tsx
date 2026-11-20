"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, Lock, MessageCircle, Send, Star, TriangleAlert } from "lucide-react";
import { Dialog } from "../dialog";
import { api } from "@/lib/client-api";
import {
  DELIVERY_INCIDENT_REASON,
  REPORT_REASONS,
  REQUEST_STATUS_LABELS,
  type MessageView,
  type PublicKeyView,
  type RequestView,
} from "@/lib/domain";
import {
  decryptForThread,
  encryptForRecipients,
  ensureIdentity,
  isEncryptionSupported,
  messageAad,
  safetyNumber,
  type RecipientKey,
} from "@/lib/e2e";
import { allowedTargets } from "@/lib/request-flow";
import type { MessageKey } from "@/lib/i18n";
import { formatWhen } from "@/lib/text";
import { useI18n } from "../i18n-provider";
import { ACTION_LABELS, type BaseDialogProps } from "./shared";

const EXCHANGE_STEPS = ["Solicitado", "Aceptado", "Entrega", "Valoración"] as const;

const CONFIRM_STATUS_TEXT: Record<"accepted" | "declined" | "cancelled", MessageKey> = {
  accepted:
    "Aceptas la solicitud: el ejemplar quedará reservado y las demás solicitudes pendientes dejarán de estar activas. Podréis acordar la entrega en la conversación.",
  declined: "Se rechaza esta solicitud. La persona podrá volver a pedir otro ejemplar.",
  cancelled: "Se cancela el intercambio y el ejemplar vuelve a estar disponible.",
};

/** Estados en los que el intercambio ya no puede avanzar. */
const CLOSED_NEGATIVE = new Set(["declined", "cancelled", "expired"]);

type ThreadPayload = {
  messages: MessageView[];
  hasMore: boolean;
  keys: { me: PublicKeyView; peer: PublicKeyView };
};
/** Clave de un dispositivo de la otra persona, con su ranura. */
type PeerKey = RecipientKey & { platform: string };

type Conversation = {
  requestId: string;
  messages: MessageView[];
  /** Una clave por dispositivo habilitado de la otra persona. */
  peerKeys: PeerKey[];
  /** Clave privada de este navegador (no sale de aquí). */
  privateKey: CryptoKey | null;
  myKeyId: string | null;
  decoded: Record<string, string>;
  /** Este navegador tiene su clave publicada en la ranura web. */
  ownKeyReady: boolean;
  peerReady: boolean;
  me: PublicKeyView;
  peer: PublicKeyView;
  /** La huella guardada de la otra persona no coincide con la actual. */
  keyChanged: boolean;
  /** Huella de seguridad de las dos cuentas, para comparar por otro canal. */
  safety: string | null;
};

/** Claves de la otra persona; admite un servidor anterior a la v40. */
function peerKeyEntries(peer: PublicKeyView): PeerKey[] {
  if (peer.keys && peer.keys.length > 0) {
    return peer.keys.map((key) => ({
      platform: key.platform,
      keyId: key.keyId,
      publicJwk: key.publicJwk,
    }));
  }
  if (peer.keyId && peer.publicJwk) {
    return [{ platform: "web", keyId: peer.keyId, publicJwk: peer.publicJwk }];
  }
  return [];
}

/** La ranura web conserva la clave de localStorage anterior a la v40. */
function pinStorageKey(userId: string, platform: string): string {
  return platform === "web" ? `b2p-key-pin:${userId}` : `b2p-key-pin:${userId}:${platform}`;
}

/** TOFU por dispositivo: añadir una ranura no es un cambio; rotarla sí. */
function checkPeerKeys(userId: string, keys: PeerKey[]): boolean {
  let changed = false;
  for (const key of keys) {
    const storage = pinStorageKey(userId, key.platform);
    const pinned = localStorage.getItem(storage);
    if (!pinned) localStorage.setItem(storage, key.keyId);
    else if (pinned !== key.keyId) changed = true;
  }
  return changed;
}

function trustPeerKeys(userId: string, keys: PeerKey[]): void {
  for (const key of keys) {
    localStorage.setItem(pinStorageKey(userId, key.platform), key.keyId);
  }
}

/** Descifra una tanda de mensajes con la clave de este navegador. */
async function decodePayload(
  messages: MessageView[],
  identity: { privateKey: CryptoKey; keyId: string },
  peerKeys: PeerKey[],
  conversationId: string,
): Promise<Record<string, string>> {
  const decoded: Record<string, string> = {};
  await Promise.all(
    messages.map(async (message) => {
      if (!message.encrypted) return;
      const text = await decryptForThread(
        identity.privateKey,
        identity.keyId,
        peerKeys,
        message,
        message.sender.id,
        conversationId,
        (senderId, keyId) => messageAad(conversationId, senderId, keyId),
      );
      if (text !== null) decoded[message.id] = text;
    }),
  );
  return decoded;
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
  const [incidentReason, setIncidentReason] = useState<string>(REPORT_REASONS[0]);
  const [incidentBusy, setIncidentBusy] = useState(false);
  const [incidentReply, setIncidentReply] = useState(request?.incidentResponse ?? "");
  const [incidentReplyError, setIncidentReplyError] = useState("");
  const [incidentReplyFeedback, setIncidentReplyFeedback] = useState("");
  const [incidentReplySending, setIncidentReplySending] = useState(false);
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
  const confirmRef = useRef<HTMLButtonElement>(null);
  const completionRef = useRef<HTMLElement>(null);
  const incidentRef = useRef<HTMLDetailsElement>(null);
  const previousStatus = useRef(request?.status);
  const requestId = request?.id ?? null;

  // La confirmación no puede quedar escondida: al abrirse el panel, el foco
  // entra en el botón que decide, no se queda en el disparador.
  useEffect(() => {
    if (confirmStatus) confirmRef.current?.focus();
  }, [confirmStatus]);

  // Al cerrarse el intercambio, el resumen y la valoración están arriba; si
  // acaba de confirmarse mientras se leía el hilo, hay que llevarlos a la vista.
  // Al abrir uno ya completado no se mueve el scroll: el título sigue a la vista.
  useEffect(() => {
    if (previousStatus.current !== "completed" && request?.status === "completed") {
      completionRef.current?.scrollIntoView({ block: "nearest" });
    }
    previousStatus.current = request?.status;
  }, [request?.status]);

  /**
   * Cerrar descarta cualquier decisión a medias. El diálogo sigue montado
   * detrás del fundido y el padre lo reutiliza para el siguiente intercambio:
   * una confirmación armada, una valoración escrita o una incidencia del libro
   * anterior no pueden sobrevivir al cambio de contexto.
   */
  function close() {
    setError("");
    setConfirmStatus(null);
    setRating("");
    setReviewComment("");
    setReviewError("");
    setReportTarget(null);
    setReportDetails("");
    setIncidentFeedback("");
    setIncidentError("");
    setIncidentReason(REPORT_REASONS[0]);
    setIncidentReply("");
    setIncidentReplyError("");
    setIncidentReplyFeedback("");
    setAnnouncement("");
    setHasOlder(false);
    onClose();
  }

  async function prepareConversation(
    payload: ThreadPayload,
    conversationId: string,
  ): Promise<Omit<Conversation, "requestId" | "messages">> {
    const me: PublicKeyView = { ...payload.keys.me };
    const peer: PublicKeyView = { ...payload.keys.peer };
    const peerKeys = peerKeyEntries(peer);
    if (peerKeys.length === 0 || !isEncryptionSupported()) {
      return {
        peerKeys: [],
        privateKey: null,
        myKeyId: null,
        decoded: {},
        ownKeyReady: false,
        peerReady: peerKeys.length > 0,
        me,
        peer,
        keyChanged: false,
        safety: null,
      };
    }
    // La ranura web es la de este navegador. Si está vacía se publica gratis;
    // si tiene otra clave, este navegador necesita la contraseña desde «Mi
    // cuenta» y nunca se sustituye en silencio.
    const serverKeys = me.keys ?? [];
    const webSlot = serverKeys.find((key) => key.platform === "web") ?? null;
    const identity = await ensureIdentity(me.id, { publishedKeyId: webSlot?.keyId ?? null });
    me.keyId = identity.keyId;
    me.publicJwk = identity.publicJwk;

    let ownKeyReady = webSlot?.keyId === identity.keyId;
    if (!webSlot) {
      try {
        await api("/api/account/keys", {
          method: "PUT",
          body: { ...identity.publicJwk, platform: "web" },
        });
        ownKeyReady = true;
      } catch {
        ownKeyReady = false;
      }
    }

    // TOFU por dispositivo: la primera huella de cada ranura se recuerda; si
    // cambia, se avisa. Añadir la ranura del móvil no es un cambio.
    const keyChanged = checkPeerKeys(peer.id, peerKeys);
    const safety = await safetyNumber([
      ...(me.keys ?? []).map((key) => key.publicJwk),
      identity.publicJwk,
      ...peerKeys.map((key) => key.publicJwk),
    ]);
    const decoded = await decodePayload(payload.messages, identity, peerKeys, conversationId);
    return {
      peerKeys,
      privateKey: identity.privateKey,
      myKeyId: identity.keyId,
      decoded,
      ownKeyReady,
      peerReady: true,
      me,
      peer,
      keyChanged,
      safety,
    };
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
          peerKeys: [],
          privateKey: null,
          myKeyId: null,
          decoded: {},
          ownKeyReady: false,
          peerReady: false,
          me: data.keys.me,
          peer: data.keys.peer,
          keyChanged: false,
          safety: null,
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
            peerKeys: thread.peerKeys,
            privateKey: thread.privateKey,
            myKeyId: thread.myKeyId,
            decoded: thread.decoded,
            peerReady: thread.peerReady,
            ownKeyReady: thread.ownKeyReady,
            me: thread.me,
            peer: thread.peer,
            keyChanged: thread.keyChanged,
            safety: thread.safety,
          }
        : {
            peerKeys: [],
            privateKey: null,
            myKeyId: null,
            decoded: {},
            peerReady: false,
            ownKeyReady: false,
            me: data.keys.me,
            peer: data.keys.peer,
            keyChanged: false,
            safety: null,
          };
      const decoded = { ...prepared.decoded };
      if (prepared.privateKey && prepared.myKeyId) {
        Object.assign(
          decoded,
          await decodePayload(
            data.messages,
            { privateKey: prepared.privateKey, keyId: prepared.myKeyId },
            prepared.peerKeys,
            requestId,
          ),
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

  // Valores estables para las funciones que se declaran más abajo: TypeScript
  // no conserva el estrechamiento de `request` dentro de un cierre.
  const requestStatus = request.status;
  const requestReviewed = request.reviewed;
  const messages = thread?.requestId === requestId ? thread.messages : [];
  const loading = !error && thread?.requestId !== requestId;
  const canSend = Boolean(
    request.status === "accepted" &&
      thread?.privateKey &&
      thread.myKeyId &&
      thread.ownKeyReady &&
      thread.peerKeys.length > 0 &&
      !thread.keyChanged,
  );
  // Arriba solo quedan las decisiones de la solicitud (aceptar/rechazar).
  // Confirmar la entrega vive junto a la conversación, que es donde se acuerda.
  const actions = allowedTargets(request.role, request.status).filter(
    (target) => target !== "cancelled" && target !== "completed",
  );
  const totalConfirmed =
    (request.confirmedByMe ? 1 : 0) + (request.confirmedByOther ? 1 : 0);
  const isOwner = request.role === "owner";
  const canOpenIncident = request.incidentCanOpen;
  const reportReasons = REPORT_REASONS.filter(
    (reason) => reason !== DELIVERY_INCIDENT_REASON || canOpenIncident,
  );
  // Cancelar es la salida de emergencia del intercambio: vive al final del
  // diálogo y desaparece en cuanto alguna de las dos partes confirma la
  // entrega, porque a partir de ahí el libro ya cambió de manos.
  const canCancel =
    allowedTargets(request.role, request.status).includes("cancelled") &&
    !request.confirmedByMe &&
    !request.confirmedByOther &&
    !request.incidentOpen;
  const closedNegative = CLOSED_NEGATIVE.has(requestStatus);
  // El panel superior solo decide entre aceptar y rechazar. Cancelar y cerrar
  // la entrega tienen sus propios paneles junto a sus botones.
  const pendingDecision =
    confirmStatus === "accepted" || confirmStatus === "declined" ? confirmStatus : null;
  const handoverDetail =
    requestStatus === "accepted" && totalConfirmed > 0
      ? t("{n} de 2 confirmaciones", { n: totalConfirmed })
      : null;

  /**
   * Estado de cada paso. El stepper no es decoración: «Solicitado» pendiente
   * está en curso, no hecho, y «Entrega» puede estar a medias.
   */
  function stepState(index: number): "done" | "current" | "upcoming" {
    if (requestStatus === "pending") return index === 0 ? "current" : "upcoming";
    if (requestStatus === "accepted") {
      return index < 2 ? "done" : index === 2 ? "current" : "upcoming";
    }
    if (requestStatus === "completed") {
      if (index < 3) return "done";
      return requestReviewed ? "done" : "current";
    }
    return index === 0 ? "done" : "upcoming";
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const body = String(formData.get("body") ?? "").trim();
    if (!body || !requestId) return;
    if (!thread?.privateKey || !thread.myKeyId || thread.peerKeys.length === 0) {
      setError(t("Falta la clave de cifrado de la conversación. Vuelve a abrir el intercambio."));
      return;
    }
    if (!thread.ownKeyReady) {
      setError(
        t("Este navegador no tiene publicada su clave de cifrado. Actívala desde «Mi cuenta»."),
      );
      return;
    }
    if (thread.keyChanged) {
      setError(t("La clave de la otra persona ha cambiado. Confírmala antes de enviar."));
      return;
    }
    setSending(true);
    setError("");
    try {
      const envelopes = await encryptForRecipients(
        thread.privateKey,
        thread.peerKeys,
        requestId,
        body,
        messageAad(requestId, thread.me.id, thread.myKeyId),
      );
      const data = await api<{ message: MessageView }>(`/api/requests/${requestId}/messages`, {
        method: "POST",
        body: { keyId: thread.myKeyId, envelopes },
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
    if (!thread) return;
    trustPeerKeys(thread.peer.id, thread.peerKeys);
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

  /** Lleva a la incidencia con el motivo de un libro que no llegó ya elegido. */
  function reportMissingBook() {
    setIncidentReason(DELIVERY_INCIDENT_REASON);
    const details = incidentRef.current;
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ block: "nearest" });
    details.querySelector("textarea")?.focus();
  }

  async function sendIncidentReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestId) return;
    const text = incidentReply.trim();
    if (text.length < 10) {
      setIncidentReplyError(t("Escribe entre 10 y 1000 caracteres."));
      return;
    }
    setIncidentReplySending(true);
    setIncidentReplyError("");
    setIncidentReplyFeedback("");
    try {
      await api(`/api/requests/${requestId}/incident`, {
        method: "POST",
        body: { response: text },
      });
      setIncidentReplyFeedback(t("Respuesta enviada."));
      onChanged();
    } catch (caught) {
      setIncidentReplyError(
        caught instanceof Error ? caught.message : t("No se pudo enviar la respuesta."),
      );
    } finally {
      setIncidentReplySending(false);
    }
  }

  async function reportIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestId) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "");
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
          reason,
          details,
        },
      });
      if (reason === DELIVERY_INCIDENT_REASON) {
        setIncidentReason(REPORT_REASONS[0]);
        onChanged();
      }
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
      await api(`/api/requests/${requestId}`, { method: "PATCH", body: { status } });
      setConfirmStatus(null);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo actualizar."));
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
      className="exchange-dialog"
      title={request.listing.title}
      description={`${request.role === "owner" ? t("Solicitud de {name}", { name: request.requester.name }) : t("Solicitado a {name}", { name: request.owner.name })} · ${t("Estado:")} ${t(REQUEST_STATUS_LABELS[request.status])}`}
      overline={t("INTERCAMBIO")}
      icon={<MessageCircle size={20} />}
    >
      {request.status === "completed" && (
        <section
          ref={completionRef}
          className="exchange-complete"
          aria-label={t("Intercambio completado")}
        >
          <p className="exchange-complete-title">
            <Check size={16} aria-hidden /> {t("Intercambio completado")}
          </p>
          <p>
            {request.role === "requester"
              ? t("El libro ya está en tu estantería y puede volver a circular.")
              : t("La otra persona ya tiene el libro en su estantería. Puede volver a circular.")}
          </p>
          {request.role === "requester" && (
            <Link className="inline-link" href="/estanteria">
              {t("Ver mi estantería")}
            </Link>
          )}
          {request.reviewed ? (
            <p className="action-feedback">
              <Star size={14} /> {t("Ya has valorado este intercambio.")}
            </p>
          ) : (
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
              <button className="primary-button small" type="submit" disabled={reviewSending}>
                {reviewSending ? t("Enviando…") : t("Enviar valoración")}
              </button>
            </form>
          )}
        </section>
      )}

      {request.incidentOpen && (
        <section className="exchange-incident" aria-label={t("Incidencia en revisión")}>
          <p className="exchange-incident-title">
            <TriangleAlert size={16} aria-hidden /> {t("Incidencia en revisión")}
          </p>
          <p>
            {request.incidentReportedByMe
              ? t("Tu incidencia está en revisión. Moderación revisará el caso; mientras tanto no se puede cerrar el intercambio.")
              : t("Hay una incidencia abierta sobre este intercambio. Puedes contar tu versión; mientras tanto no se puede cerrar.")}
          </p>
          {request.incidentReportedByMe && request.incidentResponded && (
            <p className="exchange-incident-reply">
              {t("La otra parte ha respondido. Moderación revisará las dos versiones.")}
            </p>
          )}
          {request.incidentCanRespond && (
            <form className="exchange-incident-form" onSubmit={sendIncidentReply}>
              <label htmlFor="incident-reply">{t("Cuenta qué pasó")}</label>
              <textarea
                id="incident-reply"
                rows={3}
                minLength={10}
                maxLength={1000}
                value={incidentReply}
                onChange={(event) => setIncidentReply(event.target.value)}
                required
              />
              {incidentReplyError && (
                <p className="form-error" role="alert">
                  {incidentReplyError}
                </p>
              )}
              <div className="exchange-incident-actions">
                <button
                  className="secondary-button small"
                  type="submit"
                  disabled={incidentReplySending}
                >
                  {incidentReplySending
                    ? t("Enviando…")
                    : request.incidentResponded
                      ? t("Guardar respuesta")
                      : t("Enviar respuesta")}
                </button>
                {incidentReplyFeedback && (
                  <span className="action-feedback" role="status">
                    {incidentReplyFeedback}
                  </span>
                )}
              </div>
            </form>
          )}
          <button
            type="button"
            className="text-link exchange-incident-refresh"
            onClick={onChanged}
          >
            {t("Actualizar estado")}
          </button>
        </section>
      )}

      {actions.length > 0 && (
        <div className="exchange-actions">
          {actions.map((status) => (
            <button
              key={status}
              type="button"
              className={status === "accepted" ? "primary-button small" : "secondary-button small"}
              disabled={busy}
              // Aceptar reserva el ejemplar y retira las demás solicitudes
              // pendientes; rechazar también cambia lo que la otra persona
              // espera. Las dos decisiones se confirman antes de aplicarse.
              onClick={() => setConfirmStatus(status)}
            >
              {t(ACTION_LABELS[status] ?? status)}
            </button>
          ))}
        </div>
      )}

      {pendingDecision && (
        <div className="exchange-confirm" role="group" aria-label={t("CONFIRMAR ACCIÓN")}>
          <p role="alert">{t(CONFIRM_STATUS_TEXT[pendingDecision])}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button small"
              onClick={() => setConfirmStatus(null)}
              disabled={busy}
            >
              {t("Ahora no")}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="primary-button small"
              onClick={() => void applyStatus(pendingDecision)}
              disabled={busy}
            >
              {busy
                ? t("Confirmando…")
                : pendingDecision === "accepted"
                  ? t("Sí, aceptar")
                  : t("Sí, rechazar")}
            </button>
          </div>
        </div>
      )}

      {/* Un fallo al aceptar o rechazar tiene que verse junto a esos botones,
          no después del hilo: en un pendiente el hilo aún no existe. */}
      {error && requestStatus === "pending" && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <ol className="exchange-steps" aria-label={t("Estado del intercambio")}>
        {EXCHANGE_STEPS.map((step, index) => {
          const state = stepState(index);
          return (
            <li
              key={step}
              className={`exchange-step ${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <i aria-hidden="true">{state === "done" ? <Check size={11} /> : index + 1}</i>
              <span>{t(step)}</span>
              {index === 2 && handoverDetail && (
                <span className="exchange-step-detail">{handoverDetail}</span>
              )}
            </li>
          );
        })}
      </ol>

      {closedNegative && (
        <p className="form-note" role="status">
          {t("El intercambio no llegó a completarse.")}
        </p>
      )}

      <p className="encryption-note">
        <Lock size={13} aria-hidden /> {t("Cifrado de extremo a extremo · Huella de")}{" "}
        {thread?.peer.name ?? t("la otra persona")}:{" "}
        <strong>{t(shortFingerprint(thread?.peer.keyId ?? null))}</strong>
      </p>

      {/* Una sola sección: la huella y la explicación del cifrado se leen
          juntas, sin un segundo desplegable que repita la misma idea. */}
      <details className="safety-number">
        <summary>{t("Huella de seguridad")}</summary>
        {thread?.safety && (
          <>
            <p>
              {t(
                "Compárala con {name} por otro canal. Si cambia, alguien puede haberse interpuesto.",
                { name: thread?.peer.name ?? t("la otra persona") },
              )}
            </p>
            <code>{thread.safety}</code>
          </>
        )}
        <p>
          {t(
            "Los mensajes van cifrados de extremo a extremo: la clave privada se queda en este navegador y el servidor solo guarda sobres que no puede abrir. En otro dispositivo no se leen los mensajes anteriores; si cambias, pide a la otra persona que vuelva a escribirte.",
          )}
        </p>
      </details>

      {requestStatus === "accepted" && thread && !thread.ownKeyReady && (
        <div className="key-warning" role="alert">
          <p>
            {t(
              "Este navegador no tiene publicada su clave de cifrado. Actívala desde «Mi cuenta» para leer y escribir en esta conversación.",
            )}
          </p>
          <a className="secondary-button small" href="/cuenta">
            {t("Ir a Mi cuenta")}
          </a>
        </div>
      )}

      {requestStatus === "accepted" && thread?.keyChanged && (
        <div className="key-warning" role="alert">
          <p>
            {t("La clave de {name} ha cambiado. Podría ser un dispositivo nuevo o alguien intentando leer la conversación. Verifica la huella con la otra persona antes de continuar.", { name: thread.peer.name })}
          </p>
          <button type="button" className="secondary-button small" onClick={trustPeerKey}>
            {t("Confío en esta clave")}
          </button>
        </div>
      )}

      {/* Cómo se hace llegar el libro no lo decide la plataforma: se acuerda
          aquí. */}
      {request.status === "accepted" && (
        <p className="form-hint exchange-agree">
          {t(
            "Acordad en la conversación cómo os pasáis el libro: en mano, por correo o en una Packstation.",
          )}
        </p>
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
          <p className="empty-note">
            {request.status === "accepted"
              ? t("Todavía no hay mensajes. Escribe el primero para coordinar la entrega.")
              : request.status === "pending"
                ? t("Aquí aparecerán los mensajes cuando se acepte el intercambio.")
                : t("No llegó a haber mensajes en este intercambio.")}
          </p>
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
                    className="primary-button small"
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

      {error && requestStatus !== "pending" && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {request.status === "accepted" && !loading && !thread?.peerReady && (
        <p className="form-note" role="status">
          {isEncryptionSupported()
            ? t("La otra persona todavía no ha activado el cifrado en su dispositivo. Podréis escribir en cuanto abra la aplicación una vez.")
            : t("Tu navegador no permite el cifrado de extremo a extremo.")}
        </p>
      )}

      {request.status === "accepted" && (
        <section className="exchange-handover" aria-label={t("Confirmación de la entrega")}>
          {request.confirmedByMe ? (
            <p className="form-note exchange-handover-done" role="status">
              {isOwner
                ? t("Has confirmado la entrega. El intercambio se cerrará cuando la otra persona confirme que lo ha recibido.")
                : t("Has confirmado la recepción. El intercambio se cerrará cuando la otra persona confirme la entrega.")}
            </p>
          ) : (
            <>
              <div className="exchange-handover-copy">
                <strong>{isOwner ? t("¿Ya lo has entregado?") : t("¿Ya tienes el libro?")}</strong>
                <p>
                  {isOwner
                    ? t("Confirma que ya lo has entregado o enviado. Cuando la otra persona confirme que lo ha recibido, el intercambio se cerrará.")
                    : t("Confirma que ya tienes el libro en tus manos. Cuando las dos partes hayáis confirmado, el intercambio se cerrará.")}
                </p>
                {request.confirmedByOther && (
                  <p className="exchange-handover-other">
                    {isOwner
                      ? t("La otra persona ya ha confirmado que lo recibió. Confirma tú la entrega para cerrar el intercambio.")
                      : t("La otra persona ya ha confirmado la entrega. Cuando tengas el libro, confirma que lo has recibido.")}
                  </p>
                )}
                {canOpenIncident && (
                  <button type="button" className="exchange-handover-report" onClick={reportMissingBook}>
                    {t("¿No ha llegado el libro?")}
                  </button>
                )}
                {canOpenIncident && (
                  <p className="form-hint exchange-handover-window">
                    {t("Puedes abrir una incidencia hasta 60 días después de la aceptación.")}
                  </p>
                )}
                {!isOwner && !request.incidentOpen && !canOpenIncident && (
                  <p className="form-hint">
                    {t("El plazo de 60 días para abrir la incidencia ha terminado.")}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={() => setConfirmStatus("completed")}
                disabled={busy || request.incidentOpen}
              >
                {isOwner ? t("He entregado el libro") : t("He recibido el libro")}
              </button>
            </>
          )}
          {confirmStatus === "completed" && (
            <div className="exchange-confirm" role="group" aria-label={t("CONFIRMAR ACCIÓN")}>
              <p role="alert">
                {isOwner
                  ? t("¿Confirmas que ya has entregado o enviado el libro? Si la otra persona ya confirmó la recepción, el intercambio se cerrará y no se podrá deshacer.")
                  : t("¿Confirmas que ya tienes el libro? Si la otra persona ya confirmó la entrega, el intercambio se cerrará y no se podrá deshacer.")}
              </p>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary-button small"
                  onClick={() => setConfirmStatus(null)}
                  disabled={busy}
                >
                  {t("Ahora no")}
                </button>
                <button
                  ref={confirmRef}
                  type="button"
                  className="primary-button small"
                  onClick={() => void applyStatus("completed")}
                  disabled={busy}
                >
                  {busy
                    ? t("Confirmando…")
                    : isOwner
                      ? t("Sí, lo he entregado")
                      : t("Sí, lo he recibido")}
                </button>
              </div>
            </div>
          )}
          {request.incidentOpen && (
            <p className="form-note" role="status">
              {t("El intercambio queda bloqueado hasta que la moderación resuelva la incidencia.")}
            </p>
          )}
        </section>
      )}

      {request.status === "accepted" ? (
        <form className="message-form" onSubmit={send}>
          <label className="sr-only" htmlFor="message-body">
            {t("Escribe un mensaje")}
          </label>
          <input
            id="message-body"
            name="body"
            maxLength={800}
            placeholder={
              canSend ? t("Escribe un mensaje…") : t("Mensajes cifrados no disponibles")
            }
            autoComplete="off"
            disabled={!canSend || sending}
          />
          <button
            className="primary-button small"
            type="submit"
            disabled={!canSend || sending}
            aria-label={t("Enviar mensaje")}
          >
            <Send size={15} />
          </button>
        </form>
      ) : (
        <p className="form-note" role="status">
          {request.status === "pending"
            ? t("La conversación se abre cuando se acepta el intercambio: hasta entonces no se pueden enviar mensajes.")
            : t("Este intercambio está cerrado: la conversación queda solo para consultarla.")}
        </p>
      )}

      {request.status !== "pending" && (
        <details ref={incidentRef} className="report-box incident-box">
          <summary>
            <TriangleAlert size={14} /> {t("Problema con este intercambio")}
          </summary>
          <form onSubmit={reportIncident}>
            <p className="form-note">
              {t("Cuéntanos qué ha pasado. La moderación no puede leer los mensajes cifrados.")}
            </p>
            <label htmlFor="incident-reason">{t("Motivo")}</label>
            <select
              id="incident-reason"
              name="reason"
              value={incidentReason}
              onChange={(event) => setIncidentReason(event.target.value)}
            >
              {reportReasons.map((reason) => (
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

      {/* Última salida del intercambio, lejos de los botones de decisión: una
          vez que alguna de las dos partes confirma la entrega, desaparece. */}
      {canCancel && (
        <div className="exchange-cancel">
          {confirmStatus === "cancelled" ? (
            <div className="exchange-confirm" role="group" aria-label={t("CONFIRMAR ACCIÓN")}>
              <p role="alert">
                {request.status === "pending"
                  ? t("Se retira tu solicitud y el ejemplar vuelve a estar disponible para otras personas.")
                  : t(CONFIRM_STATUS_TEXT.cancelled)}
              </p>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary-button small"
                  onClick={() => setConfirmStatus(null)}
                  disabled={busy}
                >
                  {t("Ahora no")}
                </button>
                <button
                  ref={confirmRef}
                  type="button"
                  className="primary-button small"
                  onClick={() => void applyStatus("cancelled")}
                  disabled={busy}
                >
                  {busy ? t("Confirmando…") : t("Sí, cancelar")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="exchange-cancel-button"
              onClick={() => setConfirmStatus("cancelled")}
              disabled={busy}
            >
              {request.status === "pending" ? t("Retirar la solicitud") : t("Cancelar el intercambio")}
            </button>
          )}
        </div>
      )}

    </Dialog>
  );
}

