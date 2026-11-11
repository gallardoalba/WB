import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDownUp, BookOpen, Compass, Heart, Plus, Users } from "lucide-react";
import type { SessionUser } from "@/lib/domain";
import { regionName } from "@/lib/cities";
import { BRAND_FIRST, BRAND_SECOND } from "@/lib/brand";
import { getLocale } from "@/lib/i18n-server";
import { localePath } from "@/lib/locale";
import { translate } from "@/lib/i18n";
import { countActiveRequests, countUnreadMessages, countUnreadNotifications } from "@/lib/repo";
import { SiteRail, type RailSection } from "./site-rail";
import { SiteSearch } from "./site-search";
import { AccountMenu } from "./account-menu";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { RepositoryLink } from "./repository-link";
import { VerifyEmailBanner } from "./verify-email-banner";
import { MastodonLink } from "./mastodon-link";

/**
 * Shell de las páginas internas: misma barra lateral, misma cabecera, mismo
 * ancho y mismo pie que la aplicación. Así navegar entre catálogo, clubes,
 * listas o perfiles no cambia el marco de la página.
 */
export async function SiteShell({
  user,
  section,
  title,
  children,
  rail = true,
  wide = false,
}: {
  user: SessionUser | null;
  section: RailSection;
  title: string;
  children: ReactNode;
  /** Sin barra lateral en las páginas públicas de aterrizaje (ficha de obra). */
  rail?: boolean;
  /** Ocupa todo el ancho del panel: para páginas con rejilla de libros. */
  wide?: boolean;
}) {
  // Armazón renderizado en el servidor: al navegador solo bajan las islas
  // interactivas (menú de cuenta, tema, idioma), no la cabecera entera.
  const locale = await getLocale();
  const t = (text: string) => translate(locale, text);
  // Los enlaces del armazón respetan el idioma de la URL: desde `/es/…` el pie
  // no debe devolver a la versión alemana, o Google ve las dos mezcladas.
  const href = (path: string) => {
    const [base, query] = path.split("?");
    return `${localePath(locale, base)}${query ? `?${query}` : ""}`;
  };
  // Los mismos contadores que el catálogo: el menú no puede cambiar de número
  // según la página en la que estés.
  const unreadMessages = user ? countUnreadMessages(user.id) : 0;
  const activeRequests = user ? countActiveRequests(user.id) : 0;
  const unreadNotifications = user ? countUnreadNotifications(user.id) : 0;
  return (
    <main className={rail ? "app-shell" : "app-shell no-rail"}>
      <a className="skip-link" href="#main-content">
        {t("Saltar al contenido")}
      </a>
      {rail && (
        <SiteRail
          user={user}
          section={section}
          locale={locale}
          unreadMessages={unreadMessages}
          activeRequests={activeRequests}
          unreadNotifications={unreadNotifications}
        />
      )}

      <section className="main-panel">
        <header className="topbar">
          <Link href={href("/")} className="mobile-brand" aria-label="Wanderbibliothek">
            <span className="brand-mark">
              <BookOpen size={17} strokeWidth={2.2} />
            </span>
            <span>
              {BRAND_FIRST}
              <b>{BRAND_SECOND}</b>
            </span>
          </Link>
          <div className="breadcrumb">
            <Link href={href("/")} className="crumb-home">
              {t("Inicio")}
            </Link>
            <span className="crumb-slash" aria-hidden="true">/</span>
            <strong>{title}</strong>
          </div>
          {/* Buscador global: la entrada a libros, clubes, lectores y listas
              desde cualquier página. */}
          <SiteSearch locale={locale} guest={!user} />
          <div className="topbar-actions">
            <RepositoryLink label={t("Código en GitHub")} />
            <LocaleSwitcher locale={locale} />
            <ThemeToggle />
            <AccountMenu user={user} variant="topbar" />
          </div>
        </header>

        {/* `tabIndex={-1}` para que el enlace de salto pueda mover el foco aquí:
            un `div` sin foco deja al teclado al principio de la página. */}
        <div
          className={wide ? "content-wrap content-wide" : "content-wrap"}
          id="main-content"
          tabIndex={-1}
        >
          {user && !user.emailVerified && <VerifyEmailBanner email={user.email} />}
          {children}

          <footer className="page-footer">
            <span>{t("Hecho para que las historias sigan viajando.")}</span>
            <nav className="footer-links" aria-label={t("Secciones de la comunidad")}>
              <Link href={href("/clubes")}>{t("Clubes")}</Link>
              <Link href={href("/lectores")}>{t("Lectores")}</Link>
              <Link href={href("/listas")}>{t("Listas")}</Link>
            </nav>
            <nav
              className="footer-links legal-links"
              aria-label={t("Información y documentación")}
            >
              <Link href={href("/descubrir")}>{t("Descubrir todos los libros")}</Link>
              <Link href={href("/privacidad")}>{t("Privacidad")}</Link>
              <Link href={href("/aviso-legal")}>{t("Aviso legal")}</Link>
              <Link href={href("/projekt")}>{t("El proyecto")}</Link>
              <Link href={href("/documentacion")}>{t("Documentación")}</Link>
              <MastodonLink />
            </nav>
            <span>
              <i className="footer-dot" /> {t("Comunidad abierta")} · {regionName(locale)}
            </span>
          </footer>
        </div>
      </section>

      <nav className="mobile-bottom-nav" aria-label={t("Navegación móvil")}>
        <Link href={href("/descubrir")}>
          <Compass size={19} />
          <span>{t("Descubrir")}</span>
        </Link>
        <Link href={href("/estanteria")}>
          <Heart size={19} />
          <span>{t("Estantería")}</span>
        </Link>
        <Link href={href("/?offer=1")} className="mobile-add">
          <span className="mobile-add-icon" aria-hidden="true">
            <Plus size={18} />
          </span>
          <span>{t("Ofrecer")}</span>
        </Link>
        <Link href={href("/intercambios")}>
          <ArrowDownUp size={19} />
          {/* Misma etiqueta corta que la barra de la aplicación: «Intercambios»
              no cabe en el hueco de ~76 px y se pegaba a «Comunidad». */}
          <span>{t("Cambios")}</span>
        </Link>
        <Link
          href={href("/comunidad")}
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
