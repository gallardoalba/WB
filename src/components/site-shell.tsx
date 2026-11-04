"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDownUp, BookOpen, Compass, Heart, Plus, Users } from "lucide-react";
import type { SessionUser } from "@/lib/domain";
import { regionName } from "@/lib/cities";
import { BRAND_FIRST, BRAND_SECOND } from "@/lib/brand";
import { SiteRail, type RailSection } from "./site-rail";
import { AccountMenu } from "./account-menu";
import { ThemeToggle } from "./theme-toggle";
import { useI18n } from "./i18n-provider";
import { LocaleSwitcher } from "./locale-switcher";
import { VerifyEmailBanner } from "./verify-email-banner";

/**
 * Shell de las páginas internas: misma barra lateral, misma cabecera, mismo
 * ancho y mismo pie que la aplicación. Así navegar entre catálogo, clubes,
 * listas o perfiles no cambia el marco de la página.
 */
export function SiteShell({
  user,
  section,
  title,
  children,
}: {
  user: SessionUser | null;
  section: RailSection;
  title: string;
  children: ReactNode;
}) {
  const { t, locale } = useI18n();
  return (
    <main className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("Saltar al contenido")}
      </a>
      <SiteRail user={user} section={section} />

      <section className="main-panel">
        <header className="topbar">
          <Link href="/" className="mobile-brand" aria-label="Wanderbibliothek">
            <span className="brand-mark">
              <BookOpen size={17} strokeWidth={2.2} />
            </span>
            <span>
              {BRAND_FIRST}
              <b>{BRAND_SECOND}</b>
            </span>
          </Link>
          <div className="breadcrumb">
            <Link href="/" className="crumb-home">
              {t("Inicio")}
            </Link>
            <span className="crumb-slash">/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <LocaleSwitcher locale={locale} />
            <ThemeToggle />
            <AccountMenu user={user} variant="topbar" />
          </div>
        </header>

        <div className="content-wrap" id="main-content">
          {user && !user.emailVerified && <VerifyEmailBanner email={user.email} />}
          {children}

          <footer className="page-footer">
            <span>{t("Hecho para que las historias sigan viajando.")}</span>
            <nav className="footer-links" aria-label={t("Secciones de la comunidad")}>
              <Link href="/clubes">{t("Clubes")}</Link>
              <Link href="/lectores">{t("Lectores")}</Link>
              <Link href="/listas">{t("Listas")}</Link>
            </nav>
            <span>
              <i className="footer-dot" /> {t("Comunidad abierta")} · {regionName(locale)}
            </span>
          </footer>
        </div>
      </section>

      <nav className="mobile-bottom-nav" aria-label={t("Navegación móvil")}>
        <Link href="/descubrir">
          <Compass size={19} />
          <span>{t("Descubrir")}</span>
        </Link>
        <Link href="/estanteria">
          <Heart size={19} />
          <span>{t("Estantería")}</span>
        </Link>
        <Link href="/?offer=1" className="mobile-add" aria-label={t("Ofrecer un libro")}>
          <Plus size={21} />
        </Link>
        <Link href="/intercambios">
          <ArrowDownUp size={19} />
          <span>{t("Intercambios")}</span>
        </Link>
        <Link
          href="/comunidad"
          className={
            section === "clubes" || section === "lectores" || section === "listas"
              ? "mobile-active"
              : undefined
          }
        >
          <Users size={19} />
          <span>{t("Comunidad")}</span>
        </Link>
      </nav>
    </main>
  );
}

/** Cabecera estándar de una página: título, descripción y acciones. */
export function PageHeader({
  title,
  description,
  aside,
}: {
  overline?: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <h1>{title}</h1>
        {description && <p className="page-header-description">{description}</p>}
      </div>
      {aside && <div className="page-header-actions">{aside}</div>}
    </header>
  );
}
