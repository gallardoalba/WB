"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDownUp,
  ArrowRight,
  BookOpen,
  MessageCircle,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { REQUEST_STATUS_LABELS, type RequestView } from "@/lib/domain";
import { formatWhen, toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";
import { EmptyState } from "./empty-state";

/** Un intercambio cerrado, cancelado o completado, se puede archivar. */
function canArchive(request: RequestView): boolean {
  return request.status === "completed" || request.status === "cancelled";
}

/**
 * Miniatura de la portada en la fila del intercambio.
 *
 * Muchos ISBN no tienen imagen: el servidor responde 404 y el navegador pintaba
 * el icono de «imagen rota». Aquí se sustituye por el mismo libro dibujado que
 * se usa cuando no hay portada, y el hueco entero lleva a la ficha.
 */
function MiniCover({ listing }: { listing: RequestView["listing"] }) {
  const [failed, setFailed] = useState(false);
  return (
    <Link
      href={`/libro/${listing.id}`}
      className={`mini-cover tone-${toneForId(listing.id)}`}
      // La fila ya tiene el enlace del título: este solo ahorra apuntar fino.
      aria-hidden="true"
      tabIndex={-1}
    >
      {listing.coverUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={listing.coverUrl}
          alt=""
          // La imagen viaja en el HTML del servidor y puede fallar (404) antes
          // de que React enganche `onError`: ahí el evento no llega nunca. Con
          // esta comprobación al montar, el hueco se sustituye igualmente.
          ref={(node) => {
            if (node && node.complete && node.naturalWidth === 0) setFailed(true);
          }}
          onError={() => setFailed(true)}
          onLoad={(event) => {
            // Algunos proveedores contestan 200 con una imagen 1×1.
            const image = event.currentTarget;
            if (image.naturalWidth < 20 || image.naturalHeight < 30) setFailed(true);
          }}
        />
      ) : (
        <BookOpen size={18} aria-hidden />
      )}
    </Link>
  );
}

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
  total,
  archivedRequests,
  archivedTotal,
  onOpen,
  onExplore,
  onChanged,
}: {
  requests: RequestView[];
  /** Intercambios totales de la cuenta: si son más que `requests`, hay recorte. */
  total: number;
  archivedRequests: RequestView[];
  /** Archivados totales: si son más que la lista, también hay recorte. */
  archivedTotal: number;
  onOpen: (requestId: string) => void;
  onExplore: () => void;
  /** El padre vuelve a pedir el snapshot: las dos listas cambian a la vez. */
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const archivedTab = tab === "archived";
  const items = archivedTab ? archivedRequests : requests;
  const shownTotal = archivedTab ? archivedTotal : total;

  async function toggleArchive(request: RequestView) {
    setBusyId(request.id);
    setError("");
    try {
      await api(`/api/requests/${request.id}`, {
        method: "PATCH",
        body: { archived: !request.archived },
      });
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("No se pudo archivar el intercambio. Inténtalo de nuevo."),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="shelf-tabs exchange-tabs" role="group" aria-label={t("Filtrar intercambios")}>
        {([
          ["active", "Activos"],
          ["archived", "Archivados"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            className={tab === value ? "category-tab selected" : "category-tab"}
            onClick={() => {
              setTab(value);
              setError("");
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {error && (
        <p className="form-hint exchange-error" role="alert">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        archivedTab ? (
          <EmptyState
            icon={<Archive size={24} />}
            title={t("No hay intercambios archivados")}
            hint={t("Aquí aparecen los intercambios cancelados o completados que archives.")}
          />
        ) : (
          <EmptyState
            icon={<ArrowDownUp size={24} />}
            title={t("Todavía no hay intercambios")}
            hint={t("Cuando solicites un libro, podrás seguir aquí cada paso.")}
            action={
              <button type="button" className="primary-button" onClick={onExplore}>
                {t("Explorar libros")} <ArrowRight size={16} />
              </button>
            }
          />
        )
      ) : (
        <div className="exchange-list">
          {items.map((request) => {
            const action = nextAction(request, t);
            const lastActivity = request.lastMessageAt ?? request.updatedAt;
            const archivable = canArchive(request);
            const archiveLabel = request.archived
              ? t("Restaurar intercambio de {title}", { title: request.listing.title })
              : t("Archivar intercambio de {title}", { title: request.listing.title });
            return (
            <article className="exchange-row" key={request.id}>
              <MiniCover listing={request.listing} />
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
              {archivable && (
                <button
                  type="button"
                  aria-label={archiveLabel}
                  title={archiveLabel}
                  className="exchange-open exchange-archive"
                  disabled={busyId === request.id}
                  onClick={() => toggleArchive(request)}
                >
                  {request.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                </button>
              )}
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
          {/* La vista trae un máximo de 500: si hay más, se dice. Callarlo dejaba a
              quien más intercambia con un historial que se cortaba sin avisar. */}
          {shownTotal > items.length && (
            <p className="form-hint exchange-truncated" role="status">
              {archivedTab
                ? t("Se muestran los {shown} intercambios archivados más recientes de {total}.", {
                    shown: items.length,
                    total: shownTotal,
                  })
                : t("Se muestran los {shown} intercambios más recientes de {total}.", {
                    shown: items.length,
                    total: shownTotal,
                  })}
            </p>
          )}
        </div>
      )}
    </>
  );
}
