"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, Check } from "lucide-react";
import { Dialog } from "../dialog";
import { api } from "@/lib/client-api";
import type { NotificationView } from "@/lib/domain";
import { formatWhen } from "@/lib/text";
import { localePath } from "@/lib/locale";
import { useI18n } from "../i18n-provider";
import type { BaseDialogProps } from "./shared";

export function NotificationsDialog({
  open,
  onClose,
  notifications,
  unread,
  hasMore: hasMoreProp,
  loading = false,
  error: externalError = "",
  onMarkRead,
  onRefresh,
}: BaseDialogProps & {
  notifications: NotificationView[];
  unread: number;
  /** La primera página ya trae esta información; si no, se deduce del tamaño. */
  hasMore?: boolean;
  /** La lista se está pidiendo (armazón sin snapshot). */
  loading?: boolean;
  /** Error al pedir la primera página. */
  error?: string;
  onMarkRead: () => void;
  onRefresh: () => void;
}) {
  const { t, locale } = useI18n();
  const [extra, setExtra] = useState<NotificationView[]>([]);
  // La primera página puede llegar después de montar el diálogo (armazón sin
  // snapshot): el valor del servidor manda hasta que se pida otra página.
  const [hasMoreFromLoad, setHasMoreFromLoad] = useState<boolean | null>(null);
  const hasMore = hasMoreFromLoad ?? hasMoreProp ?? notifications.length >= 25;
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  /** Avisos marcados como leídos en esta visita: no desaparecen de la lista. */
  const [readIds, setReadIds] = useState<string[]>([]);

  // El servidor manda la primera página; las demás se piden bajo demanda. El
  // desplazamiento se cuenta sobre lo que ya trajo el servidor, no sobre la
  // lista filtrada (marcar o borrar no debe repetir ni saltarse avisos).
  const items = [
    ...notifications,
    ...extra.filter((item) => !notifications.some((known) => known.id === item.id)),
  ].filter((item) => !hidden.includes(item.id));
  const offset = notifications.length + extra.length;

  async function markOne(notificationId: string) {
    setBusyId(notificationId);
    setLoadError("");
    try {
      await api(`/api/notifications/${notificationId}`, { method: "PATCH" });
      setReadIds((current) => [...current, notificationId]);
      onRefresh();
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : t("No se pudo marcar el aviso."));
    } finally {
      setBusyId(null);
    }
  }

  async function removeOne(notificationId: string) {
    setBusyId(notificationId);
    setLoadError("");
    try {
      await api(`/api/notifications/${notificationId}`, { method: "DELETE" });
      setHidden((current) => [...current, notificationId]);
      onRefresh();
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : t("No se pudo borrar el aviso."));
    } finally {
      setBusyId(null);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    setLoadError("");
    try {
      const data = await api<{ notifications: NotificationView[]; hasMore: boolean }>(
        `/api/notifications?offset=${offset}`,
      );
      setExtra((current) => [...current, ...data.notifications]);
      setHasMoreFromLoad(data.hasMore);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : t("No se pudieron cargar más avisos."));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("Avisos")}
      description={t("Novedades de tus solicitudes, intercambios y mensajes.")}
      overline={t("NOTIFICACIONES")}
      icon={<Bell size={20} />}
    >
      {unread > 0 && (
        <button type="button" className="secondary-button small mark-read" onClick={onMarkRead}>
          <Check size={14} /> {unread === 1 ? t("Marcar 1 aviso como leído") : t("Marcar {n} avisos como leídos", { n: unread })}
        </button>
      )}

      {loading && items.length === 0 ? (
        <p className="empty-note">{t("Cargando…")}</p>
      ) : items.length === 0 && !loadError && !externalError ? (
        <p className="empty-note">{t("Todavía no tienes avisos.")}</p>
      ) : (
        <ul className="inbox-list">
          {items.map((item) => {
            const isUnread = !item.readAt && !readIds.includes(item.id);
            return (
            <li key={item.id} className={isUnread ? "inbox-item unread" : "inbox-item"}>
              <div className="inbox-copy">
                <strong>{item.title}</strong>
                <span>{formatWhen(item.createdAt, locale)}</span>
                {item.body && <p>{item.body}</p>}
              </div>
              {item.link && (
                <Link className="inline-link" href={localePath(locale, item.link)} onClick={onClose}>
                  {item.type === "follow" ? t("Ver perfil") : t("Ver")} <ArrowRight size={14} />
                </Link>
              )}
              {!item.link && item.requestId && (
                <Link
                  className="inline-link"
                  href={localePath(locale, `/intercambios?t=${encodeURIComponent(item.requestId)}`)}
                  onClick={onClose}
                >
                  {t("Ver intercambio")} <ArrowRight size={14} />
                </Link>
              )}
              <div className="inbox-actions">
                {isUnread && (
                  <button
                    type="button"
                    className="message-report"
                    disabled={busyId === item.id}
                    onClick={() => markOne(item.id)}
                  >
                    {t("Marcar leído")}
                  </button>
                )}
                <button
                  type="button"
                  className="message-report"
                  disabled={busyId === item.id}
                  onClick={() => removeOne(item.id)}
                >
                  {t("Eliminar aviso")}
                </button>
              </div>
            </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          className="secondary-button small load-more"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? t("Cargando…") : t("Ver avisos anteriores")}
        </button>
      )}

      {(loadError || externalError) && (
        <p className="form-error" role="alert">
          {loadError || externalError}
        </p>
      )}
    </Dialog>
  );
}

