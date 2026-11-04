"use client";

import Link from "next/link";
import {
  ArrowDownUp,
  BookOpen,
  Compass,
  Heart,
  Lock,
  Users,
} from "lucide-react";
import type { SessionUser, View } from "@/lib/domain";
import { BRAND_FIRST, BRAND_SECOND } from "@/lib/brand";
import { AccountMenu } from "./account-menu";
import { useI18n } from "./i18n-provider";

/** Barra lateral: marca, ciudad, avisos, navegación y cuenta. */
export function AppSidebar({
  user,
  view,
  unreadMessages,
  unreadNotifications,
  activeRequests,
  onNavigate,
  onOpenAuth,
  onOpenProfile,
  onOpenNotifications,
  onLoggedOut,
}: {
  user: SessionUser | null;
  view: View;
  unreadMessages: number;
  unreadNotifications: number;
  activeRequests: number;
  onNavigate: (view: View) => void;
  onOpenAuth: () => void;
  onOpenProfile: () => void;
  onOpenNotifications: () => void;
  onLoggedOut: () => void;
}) {
  const { t } = useI18n();
  const privateClass = (active: boolean, locked: boolean) =>
    ["nav-item", active ? "active" : "", locked ? "locked" : ""].filter(Boolean).join(" ");
  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <span className="brand-mark">
          <BookOpen size={20} strokeWidth={2.2} />
        </span>
        <span>
          {BRAND_FIRST}
          <b>{BRAND_SECOND}</b>
        </span>
      </Link>

      <nav className="primary-nav" aria-label={t("Navegación principal")}>
        <button
          className={
            view === "home" || view === "discover" ? "nav-item active" : "nav-item"
          }
          aria-current={view === "home" || view === "discover" ? "page" : undefined}
          onClick={() => onNavigate("discover")}
        >
          <Compass size={18} />
          <span>{t("Descubrir")}</span>
        </button>
        <button
          className={privateClass(view === "shelf", !user)}
          aria-current={view === "shelf" ? "page" : undefined}
          aria-label={user ? undefined : t("Entra para ver tu estantería")}
          onClick={() => (user ? onNavigate("shelf") : onOpenAuth())}
        >
          {user ? <Heart size={18} /> : <Lock size={18} />}
          <span>{t("Mi estantería")}</span>
        </button>
        <button
          className={privateClass(view === "exchanges", !user)}
          aria-current={view === "exchanges" ? "page" : undefined}
          aria-label={user ? undefined : t("Entra para ver tus intercambios")}
          onClick={() => (user ? onNavigate("exchanges") : onOpenAuth())}
        >
          {user ? <ArrowDownUp size={18} /> : <Lock size={18} />}
          <span>{t("Intercambios")}</span>
          {user &&
            (unreadMessages > 0 ? (
              <span
                className="nav-count unread"
                aria-label={t("{n} mensajes sin leer", { n: unreadMessages })}
              >
                {unreadMessages}
              </span>
            ) : (
              activeRequests > 0 && <span className="nav-count">{activeRequests}</span>
            ))}
        </button>
      </nav>

      <nav className="primary-nav" aria-label={t("Comunidad")}>
        <button
          className={privateClass(view === "community", !user)}
          aria-current={view === "community" ? "page" : undefined}
          aria-label={user ? undefined : t("Entra para participar en la comunidad")}
          onClick={() => (user ? onNavigate("community") : onOpenAuth())}
        >
          {user ? <Users size={18} /> : <Lock size={18} />}
          <span>{t("Comunidad")}</span>
        </button>
      </nav>

      <AccountMenu
        user={user}
        unreadNotifications={unreadNotifications}
        onOpenAuth={onOpenAuth}
        onOpenProfile={onOpenProfile}
        onOpenNotifications={onOpenNotifications}
        onLoggedOut={onLoggedOut}
      />
    </aside>
  );
}
