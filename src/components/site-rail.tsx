import Link from "next/link";
import { ArrowDownUp, BookOpen, Compass, Heart, Lock, Plus, ShieldCheck, Users } from "lucide-react";
import type { SessionUser } from "@/lib/domain";
import { BRAND_FIRST, BRAND_SECOND } from "@/lib/brand";
import { translate } from "@/lib/i18n";
import type { Locale } from "@/lib/locale";
import { AccountMenu } from "./account-menu";

export type RailSection = "clubes" | "listas" | "lectores" | "obra" | "perfil" | "admin";

/**
 * Barra lateral de las páginas que no viven dentro del catálogo. Mantiene la
 * misma navegación y el mismo lenguaje visual que la app para que cambiar de
 * sección no parezca cambiar de producto.
 */
export function SiteRail({
  user,
  section,
  locale,
  unreadMessages = 0,
  activeRequests = 0,
  unreadNotifications = 0,
}: {
  user: SessionUser | null;
  section: RailSection;
  locale: Locale;
  unreadMessages?: number;
  activeRequests?: number;
  unreadNotifications?: number;
}) {
  const t = (text: string, vars?: Record<string, string | number>) =>
    translate(locale, text, vars);
  const itemClass = (active: boolean) => (active ? "nav-item active" : "nav-item");

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
      <p className="brand-tagline">
        {t("Libros que viajan. Personas que se encuentran.")}
      </p>

      <nav className="primary-nav" aria-label={t("Navegación principal")}>
        <Link className={itemClass(false)} href="/descubrir">
          <Compass size={18} />
          <span>{t("Descubrir")}</span>
        </Link>
        {/* Publicar es la otra acción principal y vive aquí desde el
            principio: en las páginas internas faltaba y el menú cambiaba según
            la pantalla. */}
        <Link className={itemClass(false)} href="/ofrecer">
          {user ? <Plus size={18} /> : <Lock size={18} />}
          <span>{t("Ofrecer un libro")}</span>
        </Link>
        <Link className={itemClass(section === "perfil")} href="/estanteria">
          {user ? <Heart size={18} /> : <Lock size={18} />}
          <span>{t("Mi estantería")}</span>
        </Link>
        <Link className={itemClass(false)} href="/intercambios">
          {user ? <ArrowDownUp size={18} /> : <Lock size={18} />}
          <span>{t("Intercambios")}</span>
          {user &&
            (unreadMessages > 0 ? (
              <span className="nav-count unread" aria-label={t("{n} mensajes sin leer", { n: unreadMessages })}>
                {unreadMessages}
              </span>
            ) : (
              activeRequests > 0 && <span className="nav-count">{activeRequests}</span>
            ))}
        </Link>
      </nav>

      <nav className="primary-nav" aria-label={t("Comunidad")}>
        <Link
          className={itemClass(
            section === "clubes" || section === "listas" || section === "lectores"
          )}
          href="/comunidad"
        >
          {user ? <Users size={18} /> : <Lock size={18} />}
          <span>{t("Comunidad")}</span>
        </Link>
      </nav>

      {/* La administración tiene su propia entrada: sin ella, /admin se veía
          exactamente igual que la página de cuenta. */}
      {user?.isAdmin && (
        <nav className="primary-nav" aria-label={t("Administración")}>
          <Link className={itemClass(section === "admin")} href="/admin">
            <ShieldCheck size={18} />
            <span>{t("Moderación")}</span>
          </Link>
        </nav>
      )}

      <AccountMenu user={user} unreadNotifications={unreadNotifications} />
    </aside>
  );
}
