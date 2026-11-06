"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import {
  Lock,
  MapPin,
  MessageCircle,
  Package,
  Printer,
  Send,
  Star,
  TriangleAlert,
} from "lucide-react";
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
  decryptForThread,
  encryptForRecipients,
  ensureIdentity,
  isEncryptionSupported,
  messageAad,
  type RecipientKey,
} from "@/lib/e2e";
import { printSheets } from "@/lib/print";
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
  const [incidentBusy, setIncidentBusy] = useState(false);
  // Forma de envío elegida en el formulario. Arranca con la que ya está guardada
  // y, mientras no se toque, sigue a los datos del servidor.
  const [shippingChoice, setShippingChoice] = useState<"packstation" | "address" | null>(null);
  const [shippingBusy, setShippingBusy] = useState(false);
  const [shippingError, setShippingError] = useState("");
  const [shippingFeedback, setShippingFeedback] = useState("");
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
  const [fingerprintQr, setFingerprintQr] = useState("");
  const lastSeenMessage = useRef<string | null>(null);
  const requestId = request?.id ?? null;

  // El QR solo lleva la huella corta (ocho caracteres) que se ve en pantalla:
  // escanearlo con la cámara tiene que enseñar exactamente eso, para poder
  // compararlo de un vistazo con lo que muestra la otra persona.
  const ownFingerprint = shortFingerprint(thread?.me.keyId ?? null);
  useEffect(() => {
    if (!thread?.me.keyId) return;
    let active = true;
    void import("qrcode")
      .then((module) =>
        module.default.toDataURL(`Wanderbibliothek · huella ${ownFingerprint}`, {
          width: 264,
          margin: 1,
          color: { dark: "#2f5741", light: "#ffffff" },
        }),
      )
      .then((url) => {
        if (active) setFingerprintQr(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [ownFingerprint, thread?.me.keyId]);

  // La forma del formulario: manda lo que haya elegido la persona; si no ha
  // tocado nada, la que ya está guardada (o Packstation, la opción privada).
  const shippingKind = shippingChoice ?? request?.delivery.shipping?.kind ?? "packstation";

  function close() {
    setError("");
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
      };
    }
    const identity = await ensureIdentity();
    me.keyId = identity.keyId;
    me.publicJwk = identity.publicJwk;

    // La ranura web es la de este navegador. Si está vacía se publica gratis;
    // si tiene otra clave, este navegador necesita la contraseña desde «Mi
    // cuenta» y nunca se sustituye en silencio.
    const serverKeys = me.keys ?? [];
    const webSlot = serverKeys.find((key) => key.platform === "web") ?? null;
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

  const messages = thread?.requestId === requestId ? thread.messages : [];
  const loading = !error && thread?.requestId !== requestId;
  const canSend = Boolean(
    thread?.privateKey &&
      thread.myKeyId &&
      thread.ownKeyReady &&
      thread.peerKeys.length > 0 &&
      !thread.keyChanged,
  );
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
      await api(`/api/requests/${requestId}`, { method: "PATCH", body: { status } });
      setConfirmStatus(null);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo actualizar."));
    } finally {
      setBusy(false);
    }
  }

  async function changeMethod(method: "in_person" | "post") {
    if (!requestId) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/requests/${requestId}/handover`, {
        method: "PATCH",
        body: { method },
      });
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("No se pudo cambiar la forma de entrega."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveShipping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestId) return;
    const form = new FormData(event.currentTarget);
    const campo = (name: string) => String(form.get(name) ?? "").trim();
    const kind = shippingKind;
    setShippingBusy(true);
    setShippingError("");
    setShippingFeedback("");
    try {
      await api(`/api/requests/${requestId}/handover/shipping`, {
        method: "PUT",
        body:
          kind === "packstation"
            ? {
                kind: "packstation",
                postNumber: campo("postNumber"),
                station: campo("station"),
                postalCode: campo("postalCode"),
                city: campo("city"),
              }
            : {
                kind: "address",
                street: campo("street"),
                postalCode: campo("postalCode"),
                city: campo("city"),
              },
      });
      setShippingChoice(null);
      setShippingFeedback(t("Datos de envío guardados."));
      onChanged();
    } catch (caught) {
      setShippingError(
        caught instanceof Error ? caught.message : t("No se pudieron guardar los datos de envío."),
      );
    } finally {
      setShippingBusy(false);
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
              {status === "completed"
                ? t("Confirmar entrega")
                : status === "cancelled"
                  ? t("Cancelar el intercambio")
                  : t(ACTION_LABELS[status] ?? status)}
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
        {request.delivery.method === "post" ? (
          <Package size={16} aria-hidden />
        ) : (
          <MapPin size={16} aria-hidden />
        )}
        <div>
          <strong>{t("Entrega")}</strong>
          {(request.status === "accepted" || request.status === "completed") && (
            <div className="handover-methods" role="group" aria-label={t("Forma de entrega")}>
              <button
                type="button"
                className={
                  request.delivery.method === "in_person"
                    ? "handover-method active"
                    : "handover-method"
                }
                aria-pressed={request.delivery.method === "in_person"}
                disabled={busy}
                onClick={() => void changeMethod("in_person")}
              >
                <MapPin size={14} /> {t("En mano")}
              </button>
              <button
                type="button"
                className={
                  request.delivery.method === "post"
                    ? "handover-method active"
                    : "handover-method"
                }
                aria-pressed={request.delivery.method === "post"}
                disabled={busy}
                onClick={() => void changeMethod("post")}
              >
                <Package size={14} /> {t("Por correo")}
              </button>
            </div>
          )}

          {request.delivery.method === "post" ? (
            <>
              <p className="handover-status">
                {request.delivery.shipping
                  ? request.role === "requester"
                    ? t("Datos guardados. Ya puede enviarte el libro.")
                    : t("Todo listo: imprime la etiqueta, apunta el código y envíalo.")
                  : request.role === "requester"
                    ? t("Falta un paso: guarda dónde quieres recibirlo.")
                    : t("Esperando a que {name} guarde sus datos de envío.", {
                        name: request.requester.name,
                      })}
              </p>
              {request.delivery.shipping ? (
                <>
                  <p>
                    {request.role === "requester"
                      ? request.delivery.shipping.kind === "packstation"
                        ? t(
                            "Tu libro llegará a esta Packstation. Nadie de la plataforma ve tu dirección.",
                          )
                        : t("Tu libro llegará a tu dirección. Solo la ve quien te lo envía.")
                      : request.delivery.shipping.kind === "packstation"
                        ? t(
                            "El libro viaja a la Packstation de {name}: nadie tiene que dar su dirección.",
                            { name: request.requester.name },
                          )
                        : t(
                            "El libro viaja a la dirección que {name} ha guardado. Es privada: solo la ven las dos partes del intercambio.",
                            { name: request.requester.name },
                          )}
                  </p>
                  {/* La etiqueta es de quien envía. Quien recibe la tiene
                      plegada: le sirve para comprobar qué se va a imprimir,
                      pero no es su tarea. */}
                  {request.role === "owner" ? (
                    <>
                      <div className="post-label" data-print-sheet>
                        <p className="post-label-service">{t("WARENSENDUNG")}</p>
                        <p className="post-label-name">{request.requester.name}</p>
                        {request.delivery.shipping.kind === "packstation" ? (
                          <>
                            <p>{request.delivery.shipping.postNumber}</p>
                            <p>{request.delivery.shipping.station}</p>
                          </>
                        ) : (
                          <p>{request.delivery.shipping.street}</p>
                        )}
                        <p>
                          {request.delivery.shipping.postalCode} {request.delivery.shipping.city}
                        </p>
                        <p className="post-label-sender">
                          {t("Remitente: {name} · sin dirección", {
                            name: request.owner.name,
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="message-report"
                        onClick={() => printSheets()}
                      >
                        <Printer size={14} /> {t("Imprimir la etiqueta")}
                      </button>
                    </>
                  ) : (
                    <details className="exchange-help">
                      <summary>{t("Ver la etiqueta que se imprimirá")}</summary>
                      <div className="post-label">
                        <p className="post-label-service">{t("WARENSENDUNG")}</p>
                        <p className="post-label-name">{request.requester.name}</p>
                        {request.delivery.shipping.kind === "packstation" ? (
                          <>
                            <p>{request.delivery.shipping.postNumber}</p>
                            <p>{request.delivery.shipping.station}</p>
                          </>
                        ) : (
                          <p>{request.delivery.shipping.street}</p>
                        )}
                        <p>
                          {request.delivery.shipping.postalCode} {request.delivery.shipping.city}
                        </p>
                        <p className="post-label-sender">
                          {t("Remitente: {name} · sin dirección", {
                            name: request.owner.name,
                          })}
                        </p>
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <p className="form-hint">
                  {request.role === "requester"
                    ? t(
                        "Elige cómo quieres recibirlo: en una Packstation o en tu propia dirección. Solo lo verá la persona que te manda el libro.",
                      )
                    : t(
                        "Faltan los datos de envío de {name}. En cuanto los guarde verás aquí la etiqueta.",
                        { name: request.requester.name },
                      )}
                </p>
              )}

              {request.role === "requester" && (
                <form className="shipping-form" onSubmit={saveShipping}>
                  <p className="shipping-form-title">
                    {request.delivery.shipping
                      ? t("Tus datos de envío")
                      : t("Añade tus datos de envío")}
                  </p>
                  <p className="form-hint">
                    {t("Sin ellos no se puede preparar el paquete. Puedes cambiarlos cuando quieras.")}
                  </p>
                  <div className="handover-methods" role="group" aria-label={t("Dónde lo recibes")}>
                    <button
                      type="button"
                      className={
                        shippingKind === "packstation"
                          ? "handover-method active"
                          : "handover-method"
                      }
                      aria-pressed={shippingKind === "packstation"}
                      onClick={() => setShippingChoice("packstation")}
                    >
                      <Package size={14} /> {t("Packstation")}
                    </button>
                    <button
                      type="button"
                      className={
                        shippingKind === "address" ? "handover-method active" : "handover-method"
                      }
                      aria-pressed={shippingKind === "address"}
                      onClick={() => setShippingChoice("address")}
                    >
                      <MapPin size={14} /> {t("Mi dirección")}
                    </button>
                  </div>
                  {shippingKind === "packstation" ? (
                    <>
                      <label htmlFor="ship-number">
                        {t("Número de cliente de DHL (Postnummer)")}
                        <input
                          id="ship-number"
                          name="postNumber"
                          inputMode="numeric"
                          pattern="[0-9]{8,10}"
                          maxLength={10}
                          required
                          defaultValue={request.delivery.shipping?.postNumber ?? ""}
                          placeholder="123456789"
                        />
                        <small>
                          {t("Aparece en la app Post & DHL después de registrarte gratis.")}
                        </small>
                      </label>
                      <label htmlFor="ship-station">
                        {t("Packstation")}
                        <input
                          id="ship-station"
                          name="station"
                          required
                          defaultValue={request.delivery.shipping?.station ?? "Packstation "}
                          placeholder="Packstation 123"
                        />
                      </label>
                      <div className="shipping-row">
                        <label htmlFor="ship-zip">
                          {t("Código postal")}
                          <input
                            id="ship-zip"
                            name="postalCode"
                            inputMode="numeric"
                            pattern="[0-9]{5}"
                            maxLength={5}
                            required
                            defaultValue={request.delivery.shipping?.postalCode ?? ""}
                            placeholder="10115"
                          />
                        </label>
                        <label htmlFor="ship-city">
                          {t("Ciudad de la Packstation")}
                          <input
                            id="ship-city"
                            name="city"
                            required
                            defaultValue={request.delivery.shipping?.city ?? ""}
                          />
                        </label>
                      </div>
                    </>
                  ) : (
                    <>
                      <label htmlFor="ship-street" className="ship-full">
                        {t("Calle y número")}
                        <input
                          id="ship-street"
                          name="street"
                          required
                          maxLength={120}
                          defaultValue={request.delivery.shipping?.street ?? ""}
                          placeholder="Torstraße 42"
                        />
                      </label>
                      <div className="shipping-row">
                        <label htmlFor="ship-zip">
                          {t("Código postal")}
                          <input
                            id="ship-zip"
                            name="postalCode"
                            inputMode="numeric"
                            pattern="[0-9]{5}"
                            maxLength={5}
                            required
                            defaultValue={request.delivery.shipping?.postalCode ?? ""}
                            placeholder="10119"
                          />
                        </label>
                        <label htmlFor="ship-city">
                          {t("Ciudad")}
                          <input
                            id="ship-city"
                            name="city"
                            required
                            defaultValue={request.delivery.shipping?.city ?? ""}
                          />
                        </label>
                      </div>
                    </>
                  )}
                  {shippingError && (
                    <p className="form-error" role="alert">
                      {shippingError}
                    </p>
                  )}
                  {shippingFeedback && (
                    <p className="action-feedback" role="status">
                      {shippingFeedback}
                    </p>
                  )}
                  <button
                    type="submit"
                    className="share-button small"
                    disabled={shippingBusy}
                  >
                    {shippingBusy ? t("Guardando…") : t("Guardar datos de envío")}
                  </button>
                </form>
              )}

              <details className="exchange-help">
                <summary>{t("Cómo funciona una Packstation")}</summary>
                <ul className="shipping-steps">
                  <li>
                    {t(
                      "El registro en DHL es gratuito: con una cuenta de cliente y la app Post & DHL recibes tu Postnummer, un número personal que va siempre detrás de tu nombre.",
                    )}
                  </li>
                  <li>
                    {t(
                      "Hay más de 19 000 Packstations y Poststations en Alemania y, en casi todas, puedes recoger a cualquier hora.",
                    )}
                  </li>
                  <li>
                    {t("DHL guarda el paquete hasta 9 días naturales y avisa por correo y en la app.")}
                  </li>
                  <li>
                    {t(
                      "La dirección solo lleva tu nombre, el Postnummer, «Packstation» con su número y el código postal y la ciudad: tu calle nunca aparece.",
                    )}
                  </li>
                </ul>
                <p className="form-hint">
                  <a
                    href="https://www.dhl.de/de/privatkunden/pakete-empfangen/an-einem-abholort-empfangen/packstation.html"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {t("Cómo funciona la Packstation en dhl.de")}
                  </a>
                </p>
              </details>

              <details className="exchange-help">
                <summary>{t("Cómo enviarlo: Warensendung")}</summary>
                <ol className="shipping-steps">
                  <li>
                    {t(
                      "Lo más privado es una Packstation: quien recibe se registra gratis en DHL y obtiene su número de cliente (Postnummer) y una taquilla.",
                    )}
                  </li>
                  <li>
                    {t(
                      "Si prefiere el correo normal, guarda su dirección en esta ventana. Es igual de válida y también va cifrada.",
                    )}
                  </li>
                  <li>
                    {t(
                      "Copia en el paquete lo que dice la etiqueta: nombre, Postnummer y «Packstation 123», o la calle, y siempre el código postal y la ciudad. Nunca «Postlagernd»: es otro servicio.",
                    )}
                  </li>
                  <li>
                    {t(
                      "Como remitente basta tu nombre, sin calle ni código postal: así no revelas dónde vives.",
                    )}
                  </li>
                  <li>
                    {t(
                      "Envíalo como Warensendung: hasta 2 kg y 35,3 × 25 × 5 cm. No lleva seguimiento ni seguro.",
                    )}
                  </li>
                  <li>
                    {t(
                      "Apunta a mano el código de entrega de 6 cifras en un papel y mételo dentro del libro: no hace falta imprimir nada.",
                    )}
                  </li>
                  <li>
                    {t(
                      "Quien recibe lo recoge en la Packstation con la app Post & DHL y confirma el código aquí.",
                    )}
                  </li>
                </ol>
                <p className="form-hint">
                  {t(
                    "Precios orientativos de Deutsche Post: 2,70 € hasta 1 kg y 3,55 € hasta 2 kg. Confírmalos al enviarlo.",
                  )}
                </p>
              </details>
            </>
          ) : (
            <>
              <p>
                {request.status === "accepted" || request.status === "completed"
                  ? t("Quedad donde os venga bien: un café, la biblioteca del barrio, la puerta del trabajo.")
                  : t("Al aceptar el intercambio acordáis dónde os lo dais.")}
              </p>
              <p className="form-hint handover-privacy">
                {t("La plataforma no pide ninguna dirección: el sitio lo elegís vosotros en la conversación.")}
              </p>
            </>
          )}
        </div>
      </div>

      {request.status === "accepted" && !request.confirmedByMe && (
        <HandoverCode
          requestId={request.id}
          code={request.handoverCode}
          required={request.handoverCodeRequired}
          method={request.delivery.method === "post" ? "post" : "in_person"}
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
          {t(
            "Los mensajes van cifrados de extremo a extremo: la clave privada se queda en este navegador y el servidor solo guarda sobres que no puede abrir. En otro dispositivo no se leen los mensajes anteriores; si cambias, pide a la otra persona que vuelva a escribirte.",
          )}
        </p>
        <p>
          {t(
            "Los datos de envío son otra cosa: se guardan cifrados con la clave de la plataforma y solo se descifran para las dos personas del intercambio, dentro de la aplicación. El servidor de esta instancia sí puede leerlos; los mensajes no.",
          )}
        </p>

        {/* Huella corta para comparar en persona: sin esto, `keyChanged` avisa
            pero no hay forma sencilla de comprobar que la clave es la buena. */}
        <div className="fingerprint-compare">
          <p className="fingerprint-title">{t("Comprobar que hablamos con quien creemos")}</p>
          <p className="form-hint">
            {t("Tu huella y la de {name} tienen que coincidir con lo que veis cada uno en vuestra pantalla. En persona, deja que la otra persona escanee este código: la cámara le mostrará el mismo texto.", { name: thread?.peer.name ?? t("la otra persona") })}
          </p>
          <div className="fingerprint-row">
            <div className="fingerprint-qr">
              {fingerprintQr ? (
                <Image
                  src={fingerprintQr}
                  alt={t("QR con tu huella de cifrado")}
                  width={132}
                  height={132}
                  unoptimized
                />
              ) : null}
            </div>
            <dl className="fingerprint-list">
              <div>
                <dt>{t("Tu huella")}</dt>
                <dd>{t(shortFingerprint(thread?.me.keyId ?? null))}</dd>
              </div>
              <div>
                <dt>{thread?.peer.name ?? t("La otra persona")}</dt>
                <dd>{t(shortFingerprint(thread?.peer.keyId ?? null))}</dd>
              </div>
            </dl>
          </div>
        </div>
      </details>

      {thread && !thread.ownKeyReady && (
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

      {!loading && !thread?.peerReady && (
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
            canSend ? t("Escribe un mensaje…") : t("Mensajes cifrados no disponibles")
          }
          autoComplete="off"
          disabled={!canSend || sending}
        />
        <button
          className="share-button small"
          type="submit"
          disabled={!canSend || sending}
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

