"use client";

import Link from "next/link";
import { ArrowDownUp, ArrowRight, BookOpen, MessageCircle } from "lucide-react";
import { REQUEST_STATUS_LABELS, type RequestView } from "@/lib/domain";
import { formatWhen, toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";

/** Siguiente paso que corresponde a quien mira, si lo hay. */
function nextAction(request: RequestView, t: (text: string) => string): string | null {
  if (request.status === "pending") {
    return request.role === "owner" ? t("Acepta o rechaza la solicitud") : t("Esperando respuesta");
  }
  if (request.status === "accepted") {
    if (!request.confirmedByMe) return t("Confirma la entrega");
    if (!request.confirmedByOther) return t("Esperando la confirmación de la otra parte");
    return null;
  }
  if (request.status === "completed") {
    return request.reviewed ? null : t("Deja tu valoración");
  }
  return null;
}

/** Lista de intercambios de la vista «Intercambios». */
export function ExchangesList({
  requests,
  onOpen,
  onExplore,
}: {
  requests: RequestView[];
  onOpen: (requestId: string) => void;
  onExplore: () => void;
}) {
  const { t, locale } = useI18n();
  if (requests.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <ArrowDownUp size={24} />
        </span>
        <h3>{t("Todavía no hay intercambios")}</h3>
        <p>{t("Cuando solicites un libro, podrás seguir aquí cada paso.")}</p>
        <button type="button" className="share-button" onClick={onExplore}>
          {t("Explorar libros")} <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="exchange-list">
      {requests.map((request) => {
        const action = nextAction(request, t);
        const lastActivity = request.lastMessageAt ?? request.updatedAt;
        return (
        <article className="exchange-row" key={request.id}>
          <div className={`mini-cover tone-${toneForId(request.listing.id)}`}>
            {request.listing.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={request.listing.coverUrl} alt="" />
            ) : (
              <BookOpen size={18} />
            )}
          </div>
          <div className="exchange-info">
            <strong>
              <Link href={`/libro/${request.listing.id}`} className="card-link">
                {request.listing.title}
              </Link>
            </strong>
            <span>
              {request.role === "owner"
                ? t("Solicitud de {name}", { name: request.requester.name })
                : t("Solicitado a {name}", { name: request.owner.name })}
              {request.delivery.method === "hand"
                ? ` · ${t("En mano")}`
                : request.delivery.pickupPoint
                  ? ` · ${request.delivery.pickupPoint.name}`
                  : ` · ${t("Oficina")}`}
              {request.messageCount > 0
                ? ` · ${request.messageCount} ${
                    request.messageCount === 1 ? t("mensaje") : t("mensajes")
                  }`
                : ""}
              {" · "}
              {formatWhen(lastActivity, locale)}
            </span>
            {action && <span className="exchange-next">{action}</span>}
          </div>
          <span className={`status-chip ${request.status}`}>
            {t(REQUEST_STATUS_LABELS[request.status])}
          </span>
          <button
            type="button"
            aria-label={t("Abrir intercambio de {title}", { title: request.listing.title }) +
              (request.unreadMessages > 0
                ? ` (${t("{n} sin leer", { n: request.unreadMessages })})`
                : "")}
            className={request.unreadMessages > 0 ? "exchange-open unread" : "exchange-open"}
            onClick={() => onOpen(request.id)}
          >
            <MessageCircle size={18} />
            {request.unreadMessages > 0 && <span className="exchange-dot" aria-hidden="true" />}
          </button>
        </article>
        );
      })}
    </div>
  );
}
