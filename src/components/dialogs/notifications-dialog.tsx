"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, Check } from "lucide-react";
import { Dialog } from "../dialog";
import { api } from "@/lib/client-api";
import type { NotificationView } from "@/lib/domain";
import { formatWhen } from "@/lib/text";
import { useI18n } from "../i18n-provider";
import type { BaseDialogProps } from "./shared";

export function NotificationsDialog({
  open,
  onClose,
  notifications,
  unread,
  onMarkRead,
  onRefresh,
}: BaseDialogProps & {
  notifications: NotificationView[];
  unread: number;
  onMarkRead: () => void;
  onRefresh: () => void;
}) {
  const { t, locale } = useI18n();
  const [extra, setExtra] = useState<NotificationView[]>([]);
  const [hasMore, setHasMore] = useState(notifications.length >= 25);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);

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
      setHidden((current) => [...current, notificationId]);
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
      setHasMore(data.hasMore);
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

      {items.length === 0 ? (
        <p className="empty-note">{t("Todavía no tienes avisos.")}</p>
      ) : (
        <ul className="inbox-list">
          {items.map((item) => (
            <li key={item.id} className={item.readAt ? "inbox-item" : "inbox-item unread"}>
              <div className="inbox-copy">
                <strong>{item.title}</strong>
                <span>{formatWhen(item.createdAt, locale)}</span>
                {item.body && <p>{item.body}</p>}
              </div>
              {item.link && (
                <Link className="inline-link" href={item.link} onClick={onClose}>
                  {item.type === "follow" ? t("Ver perfil") : t("Ver")} <ArrowRight size={14} />
                </Link>
              )}
              {!item.link && item.requestId && (
                <Link className="inline-link" href="/?view=exchanges" onClick={onClose}>
                  {t("Ver intercambio")} <ArrowRight size={14} />
                </Link>
              )}
              <div className="inbox-actions">
                {!item.readAt && (
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
          ))}
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

      {loadError && (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      )}
    </Dialog>
  );
}

