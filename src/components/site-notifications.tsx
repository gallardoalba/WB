"use client";

import dynamic from "next/dynamic";
import { useEffect, useEffectEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell } from "lucide-react";
import { api } from "@/lib/client-api";
import type { NotificationView } from "@/lib/domain";
import { useI18n } from "./i18n-provider";

const NotificationsDialog = dynamic(() =>
  import("./dialogs/notifications-dialog").then((module) => module.NotificationsDialog),
);

type NotificationsPayload = {
  notifications: NotificationView[];
  hasMore: boolean;
  unread: number;
};

/**
 * Campana de avisos de las páginas que no viven dentro del catálogo.
 *
 * El armazón principal (`WanderbibliothekApp`) ya tiene su diálogo con los
 * avisos del snapshot. Aquí no hay snapshot: la lista se pide al abrir y se
 * pinta en la misma página, sin mandar a la portada. También acepta
 * `?notifications=1`, que es lo que usa el menú de cuenta de la barra lateral.
 */
export function SiteNotifications({ initialUnread }: { initialUnread: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("notifications") === "1";
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api<NotificationsPayload>("/api/notifications");
      setNotifications(data.notifications);
      setHasMore(data.hasMore);
      setUnread(data.unread);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("No se pudieron cargar los avisos."),
      );
    } finally {
      setLoading(false);
    }
  }

  const loadOnOpen = useEffectEvent(() => {
    void load();
  });

  // En `requestAnimationFrame`: abrir y cargar en el cuerpo del efecto choca
  // con la regla `react-hooks/set-state-in-effect`.
  useEffect(() => {
    if (!requested) return;
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [requested]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => loadOnOpen());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  async function markAllRead() {
    try {
      await api("/api/notifications/read", { method: "POST" });
      await load();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("No se pudieron marcar los avisos como leídos."),
      );
    }
  }

  function close() {
    setOpen(false);
    if (!requested) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("notifications");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function refresh() {
    void load();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className="icon-button notification-button"
        aria-label={
          unread > 0
            ? t("Notificaciones: {n} avisos sin leer", {
                n: unread > 9 ? "9+" : String(unread),
              })
            : t("Notificaciones")
        }
        onClick={() => setOpen(true)}
      >
        <Bell size={19} />
        {unread > 0 && (
          <i className="notification-count" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </i>
        )}
      </button>
      <NotificationsDialog
        open={open}
        onClose={close}
        notifications={notifications}
        unread={unread}
        hasMore={hasMore}
        loading={loading}
        error={error}
        onMarkRead={() => void markAllRead()}
        onRefresh={refresh}
      />
    </>
  );
}
