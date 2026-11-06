"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { KeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Heart,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { ListingCard } from "./listing-card";
import { EmptyState } from "./empty-state";
import { AppSidebar } from "./app-sidebar";
import { AccountMenu } from "./account-menu";
import { ThemeToggle } from "./theme-toggle";
import { ReaderCard } from "./reader-card";
import { LocaleSwitcher } from "./locale-switcher";
import { RepositoryLink } from "./repository-link";
import { ListingPreview } from "./listing-preview";
import { VerifyEmailBanner } from "./verify-email-banner";
import { BRAND, BRAND_FIRST, BRAND_SECOND } from "@/lib/brand";
import { AuthDialog } from "./dialogs/auth-dialog";
import { SiteSearch } from "./site-search";

// Los diálogos pesados (cripto E2E y QR, TOTP, escáner ISBN) solo se descargan
// cuando se abren: el catálogo no paga su bundle.
const ExchangeDialog = dynamic(() =>
  import("./dialogs/exchange-dialog").then((module) => module.ExchangeDialog),
);
const OfferForm = dynamic(() => import("./offer-form").then((module) => module.OfferForm), {
  loading: () => <p className="empty-note">Cargando…</p>,
});
const NotificationsDialog = dynamic(() =>
  import("./dialogs/notifications-dialog").then((module) => module.NotificationsDialog),
);
/**
 * Estas piezas solo las pinta una vista concreta (comunidad o intercambios),
 * así que se descargan cuando de verdad se usan: antes viajaban en el paquete
 * inicial de la portada sin pintarse nunca. La previsualización del ejemplar se
 * queda estática a propósito: está montada siempre, así que su trozo llegaría a
 * la hidratación inicial y solo añadiría una espera.
 */
const ExchangesList = dynamic(() =>
  import("./exchanges-list").then((module) => module.ExchangesList),
);
const ClubBoard = dynamic(() => import("./club-board").then((module) => module.ClubCreate));
const ClubCard = dynamic(() => import("./club-card").then((module) => module.ClubCard));
import {
  CATALOG_LANGUAGES,
  CATEGORIES,
  SORTS,
  VIEW_PATHS,
  type ActivityView,
  type AppSnapshot,
  type CommunityTab,
  type ListingView,
  type SortMode,
  type View,
} from "@/lib/domain";
import { api } from "@/lib/client-api";
import { ensureIdentity } from "@/lib/e2e";
import { formatNumber } from "@/lib/text";
import type { MessageKey } from "@/lib/i18n";
import { regionName } from "@/lib/cities";
import { formatWhen, initialsOf, toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";

const ACTIVITY_COPY: Record<ActivityView["type"], MessageKey> = {
  published: "ha compartido",
  requested: "ha solicitado",
  accepted: "ha aceptado un intercambio de",
  completed: "ha completado un intercambio de",
};

const SORT_LABELS: Record<SortMode, MessageKey> = {
  near: "Más cercanos",
  recent: "Más recientes",
  title: "Título A–Z",
};

const RADIUS_OPTIONS = [0, 10, 25, 50, 100] as const;

const VIEW_LABELS = {
  home: "Inicio",
  discover: "Descubrir",
  shelf: "Mi estantería",
  community: "Comunidad",
  exchanges: "Intercambios",
  offer: "Ofrecer un libro",
} satisfies Record<View, MessageKey>;

const VIEW_TITLES = {
  home: "Libros que buscan lector",
  discover: "Encuentra tu próxima historia",
  shelf: "Tu estantería guardada",
  community: "La lectura se comparte",
  exchanges: "Tus intercambios",
  offer: "Cuéntanos qué libro ofreces",
} satisfies Record<View, MessageKey>;

const COMMUNITY_TAB_LABELS: Record<CommunityTab, MessageKey> = {
  conversations: "Conversaciones",
  activity: "Actividad",
  clubs: "Clubes",
  readers: "Lectores",
  lists: "Listas",
};

const COMMUNITY_TABS_ORDER = Object.keys(COMMUNITY_TAB_LABELS) as CommunityTab[];

export default function WanderbibliothekApp({
  snapshot,
  openAuth = false,
  openNotifications = false,
  nextPath = null,
}: {
  snapshot: AppSnapshot;
  openAuth?: boolean;
  openNotifications?: boolean;
  nextPath?: string | null;
}) {
  const { user, view, filters, listings, total, page, pageSize, hasMore, requests, activeRequests, activity, conversations, clubs, clubsTotal, readers, readersTotal, publicLists, stats, unreadNotifications, unreadMessages, notifications } = snapshot;
  const { t, locale } = useI18n();
  const REGION = regionName(locale);
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // El campo de búsqueda es un borrador atado al `q` de la URL: si la URL
  // cambia (atrás/adelante, un enlace o un chip) el texto se resincroniza sin
  // un efecto que devuelva la consulta vieja al servidor.
  const [searchDraft, setSearchDraft] = useState({ query: filters.q, value: filters.q });
  // Los filtros secundarios (distancia e idioma) se pliegan en móvil para que
  // la primera tarjeta no quede a 600 px del borde superior.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters =
    (filters.radius !== 0 ? 1 : 0) +
    (filters.language && filters.language !== CATALOG_LANGUAGES[0] ? 1 : 0);
  const search = searchDraft.query === filters.q ? searchDraft.value : filters.q;
  const setSearch = useCallback(
    (value: string) => setSearchDraft({ query: filters.q, value }),
    [filters.q],
  );
  const [authOpen, setAuthOpen] = useState(openAuth);
  const [authNext, setAuthNext] = useState<string | null>(null);
  // Si la página llega con `?auth=1` en una navegación de cliente (el servidor
  // redirigiendo una vista privada), el estado inicial ya no se recalcula. Se
  // ajusta durante el render —el patrón que recomienda React para «estado que
  // depende de una prop»— en vez de con un efecto, que encadena renders.
  const [authProp, setAuthProp] = useState(openAuth);
  if (openAuth !== authProp) {
    setAuthProp(openAuth);
    if (openAuth) setAuthOpen(true);
  }
  const [previewListing, setPreviewListing] = useState<ListingView | null>(null);

  const [notificationsOpen, setNotificationsOpen] = useState(openNotifications);
  const [exchangeId, setExchangeId] = useState<string | null>(null);
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({});
  const [busyFavorite, setBusyFavorite] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFavorite = useRef<{ id: string; favorite: boolean } | null>(null);

  // Si una petición responde 401, la sesión ya no vale. Se reabre el acceso
  // con esta página como destino, en lugar de dejar al usuario ante un error
  // que no puede resolver por sí mismo.
  useEffect(() => {
    function onAuthRequired() {
      setAuthNext(`${window.location.pathname}${window.location.search}`);
      setAuthOpen(true);
    }
    window.addEventListener("wb:auth-required", onAuthRequired);
    return () => window.removeEventListener("wb:auth-required", onAuthRequired);
  }, []);

  const notify = useCallback((message: string, tone: "ok" | "error" = "ok") => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    // Un error necesita más tiempo de lectura que una confirmación.
    toastTimer.current = setTimeout(() => setToast(null), tone === "error" ? 6000 : 3500);
  }, []);

  const clearQueryParams = useCallback((...keys: string[]) => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of keys) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  // Al iniciar sesión se crea (o recupera) el par de claves del navegador y se
  // publica solo la mitad pública. La privada no sale de IndexedDB.
  const keysPublished = useRef<string | null>(null);
  useEffect(() => {
    if (!user || keysPublished.current === user.id) return;
    keysPublished.current = user.id;
    let cancelled = false;
    void (async () => {
      try {
        const identity = await ensureIdentity();
        const stored = await api<{
          keys: { platform: string; keyId: string }[];
        }>("/api/account/keys");
        if (cancelled) return;
        // Solo se publica la **primera** clave de la ranura web. Sustituir una
        // existente exige la contraseña y se hace desde el perfil, nunca en
        // silencio al entrar. La app móvil publica su propia ranura.
        const web = stored.keys?.find((key) => key.platform === "web") ?? null;
        if (!web) {
          await api("/api/account/keys", {
            method: "PUT",
            body: { ...identity.publicJwk, platform: "web" },
          });
        }
      } catch {
        keysPublished.current = null;
        if (!cancelled) notify(t("No se pudo activar el cifrado de mensajes en este navegador."), "error");
      }
    })();
    return () => {
      cancelled = true;
      // Al desmontar se olvida la marca: si el efecto se vuelve a montar con el
      // mismo usuario (doble invocación de React en desarrollo, o una recarga
      // del shell) la publicación pendiente se reintenta en vez de quedarse a
      // medias y dejar la cuenta sin clave.
      keysPublished.current = null;
    };
  }, [notify, user, t]);

  // Mantiene viva la cookie de sesión mientras la persona sigue usando la app:
  // el servidor renueva la fila, pero la cookie del navegador también debe
  // actualizarse (máximo absoluto de 30 días).
  useEffect(() => {
    if (!user) return;
    const ping = () => {
      if (document.visibilityState === "visible") {
        void fetch("/api/auth/me", { cache: "no-store" }).catch(() => undefined);
      }
    };
    ping();
    document.addEventListener("visibilitychange", ping);
    const timer = setInterval(ping, 6 * 60 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", ping);
      clearInterval(timer);
    };
  }, [user]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const navigate = useCallback(
    (patch: Record<string, string | number | undefined>) => {
      const next: Record<string, string | number | undefined> = {
        view,
        q: filters.q,
        category: filters.category,
        language: filters.language,
        sort: filters.sort,
        radius: filters.radius,
        shelf: filters.shelf,
        feed: filters.feed,
        tag: filters.tag,
        tab: filters.tab,
        scope: filters.scope,
        page,
        ...patch,
      };
      const params = new URLSearchParams();
      if (next.q) params.set("q", String(next.q));
      if (next.category && next.category !== "Todos") params.set("category", String(next.category));
      if (next.language && next.language !== "Todos") params.set("language", String(next.language));
      if (next.sort && next.sort !== "near") params.set("sort", String(next.sort));
      if (Number(next.radius) > 0) params.set("radius", String(next.radius));
      if (next.shelf && next.shelf !== "all") params.set("shelf", String(next.shelf));
      if (next.feed && next.feed !== "all") params.set("feed", String(next.feed));
      if (next.tag) params.set("tag", String(next.tag));
      if (next.tab && next.tab !== "conversations") params.set("tab", String(next.tab));
      if (next.scope && next.scope !== "region") params.set("scope", String(next.scope));
      if (Number(next.page) > 1) params.set("page", String(next.page));
      const query = params.toString();
      // Cada vista tiene su ruta: la URL queda compartible (`/estanteria?page=2`).
      const target = VIEW_PATHS[next.view as View] ?? pathname;
      startTransition(() => {
        router.replace(query ? `${target}?${query}` : target, { scroll: false });
      });
    },
    [filters.category, filters.feed, filters.language, filters.q, filters.radius, filters.shelf, filters.sort, filters.tag, filters.tab, filters.scope, page, pathname, router, view],
  );

  // Al cambiar de vista el foco sigue donde estaba y el lector de pantalla no
  // anuncia nada nuevo. Se mueve al título de la vista (que recibirá
  // `tabIndex={-1}`); en la primera pintura no se toca.
  const viewRef = useRef(view);
  useEffect(() => {
    if (viewRef.current === view) return;
    viewRef.current = view;
    const heading = document.querySelector<HTMLElement>("#main-content h1");
    heading?.focus();
  }, [view]);

  const visibleSorts = user ? SORTS : SORTS.filter((sort) => sort !== "near");
  const sortValue = !user && filters.sort === "near" ? "recent" : filters.sort;

  function clearFilters() {
    setSearch("");
    navigate({ q: "", tag: "", category: "Todos", language: "Todos", radius: 0, page: 1 });
  }

  // Teclado de las pestañas: flechas, Inicio y Fin (patrón tablist).
  const onCommunityTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = COMMUNITY_TABS_ORDER.indexOf(filters.tab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? COMMUNITY_TABS_ORDER.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + COMMUNITY_TABS_ORDER.length) %
            COMMUNITY_TABS_ORDER.length;
    const next = COMMUNITY_TABS_ORDER[nextIndex];
    navigate({ tab: next, page: 1 });
    requestAnimationFrame(() => document.getElementById(`community-tab-${next}`)?.focus());
  };

  // Búsqueda con retardo: el filtrado se resuelve en el servidor.
  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => navigate({ q: search, page: 1 }), 350);
    return () => clearTimeout(timer);
  }, [search, filters.q, navigate]);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const requireAuth = useCallback(() => {
    if (user) return true;
    setAuthOpen(true);
    return false;
  }, [user, setAuthOpen]);

  const exchangeRequest = exchangeId ? requests.find((item) => item.id === exchangeId) ?? null : null;

  const isFavorite = (id: string, fallback: boolean) => favoriteOverrides[id] ?? fallback;

  async function toggleFavorite(listingId: string, current: boolean) {
    if (!user) {
      pendingFavorite.current = { id: listingId, favorite: !current };
      setAuthOpen(true);
      return;
    }
    const next = !current;
    setFavoriteOverrides((overrides) => ({ ...overrides, [listingId]: next }));
    setBusyFavorite(listingId);
    try {
      await api(`/api/listings/${listingId}/favorite`, { method: "POST", body: { favorite: next } });
      refresh();
    } catch (error) {
      setFavoriteOverrides((overrides) => ({ ...overrides, [listingId]: !next }));
      notify(
        error instanceof Error ? error.message : t("No se pudo actualizar tu estantería."),
        "error",
      );
    } finally {
      setBusyFavorite(null);
    }
  }

  function openOffer() {
    if (!requireAuth()) return;
    navigate({ view: "offer", page: 1 });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function markNotificationsRead() {
    try {
      await api("/api/notifications/read", { method: "POST" });
      refresh();
    } catch {
      notify(t("No se pudieron marcar los avisos como leídos."), "error");
    }
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="app-shell" aria-busy={isPending}>
      {isPending && <div className="nav-progress" role="progressbar" aria-label={t("Cargando")} />}
      <a className="skip-link" href="#main-content">
        {t("Saltar al contenido")}
      </a>

      {/* El panel lateral es de quien ha entrado: sin sesión no hay menú que
          enseñar (todo lo que hay dentro pide sesión). */}
      {user && (
      <AppSidebar
        user={user}
        view={view}
        unreadMessages={unreadMessages}
        unreadNotifications={unreadNotifications}
        activeRequests={activeRequests}
        onNavigate={(next) => navigate({ view: next, page: 1 })}
        onOpenAuth={() => setAuthOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onLoggedOut={() => {
          refresh();
          notify(t("Has cerrado sesión."));
        }}
        onOffer={openOffer}
      />
      )}

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
            {view !== "home" && (
              <>
                <span className="crumb-slash">/</span>
                <strong>{t(VIEW_LABELS[view])}</strong>
              </>
            )}
          </div>
          {/* Mismo buscador global que el resto de páginas: obras, clubes,
              lectores y listas desde cualquier vista. */}
          <SiteSearch locale={locale} />
          <div className="topbar-actions">
            <RepositoryLink label={t("Código en GitHub")} />
            <LocaleSwitcher locale={locale} />
            <ThemeToggle />
            {user && (
              <button
                type="button"
                className="icon-button notification-button"
                aria-label={
                  unreadNotifications > 0
                    ? t("Notificaciones: {n} avisos sin leer", { n: unreadNotifications })
                    : t("Notificaciones")
                }
                onClick={() => {
                  if (!requireAuth()) return;
                  setNotificationsOpen(true);
                }}
              >
                <Bell size={19} />
                {unreadNotifications > 0 && (
                  <i className="notification-count" aria-hidden="true">
                    {unreadNotifications > 9 ? "9+" : unreadNotifications}
                  </i>
                )}
              </button>
            )}
            <AccountMenu
              user={user}
              variant="topbar"
              unreadNotifications={unreadNotifications}
              onOpenAuth={() => setAuthOpen(true)}
              onOpenNotifications={() => setNotificationsOpen(true)}
              onLoggedOut={() => {
                refresh();
                notify(t("Has cerrado sesión."));
              }}
            />
          </div>
        </header>

        <div className="content-wrap home-content" id="main-content">
          {user && !user.emailVerified && <VerifyEmailBanner email={user.email} />}
          {view === "home" && (
            <section className="hero-banner">
              <div className="hero-copy">
                {/* La portada abre con la marca y su lema; el titular largo
                    («Los libros siguen viajando») repetía la idea del lema y
                    se ha retirado: una sola frase de marca y el párrafo. */}
                <h1 tabIndex={-1}>
                  <span className="hero-brand">{BRAND}</span>
                </h1>
                <p className="hero-tagline">
                  {t("Libros que viajan. Personas que se encuentran.")}
                </p>
                <p>
                  {user
                    ? t(
                        "Encuentra historias que ya tienen ganas de llegar a tus manos. Elige tu ciudad y mira qué libros tienes al lado.",
                      )
                    : t(
                        "Cada libro guarda algo de quien lo leyó. Comparte aquellos que te han marcado y sé parte de la comunidad: en cada intercambio viajan un libro, una historia y una conversación.",
                      )}
                </p>
                <button
                  type="button"
                  className="hero-button"
                  onClick={() => {
                    // El catálogo es público: se puede ojear sin cuenta. Pedir
                    // un libro concreto sí abrirá el acceso más adelante.
                    navigate({ view: "discover", page: 1 });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  {t("Explorar libros")} <ArrowRight size={16} />
                </button>
              </div>
              <div className="hero-stats">
                <div className="hero-stat">
                  <strong>{formatNumber(stats.available, locale)}</strong>
                  <span className="hero-stat-label">
                    {stats.available === 1 ? t("libro disponible") : t("libros disponibles")}
                  </span>
                </div>
                <div className="hero-stat">
                  <strong>{formatNumber(stats.completed, locale)}</strong>
                  <span className="hero-stat-label">
                    {stats.completed === 1 ? t("intercambio hecho") : t("intercambios hechos")}
                  </span>
                </div>
                <div className="hero-stat">
                  <strong>{formatNumber(stats.members, locale)}</strong>
                  <span className="hero-stat-label">
                    {stats.members === 1 ? t("lector registrado") : t("lectores registrados")}
                  </span>
                </div>
                <div className="hero-stat">
                  <strong>{formatNumber(stats.clubs, locale)}</strong>
                  <span className="hero-stat-label">
                    {stats.clubs === 1 ? t("club de lectura") : t("clubes de lectura")}
                  </span>
                </div>
              </div>
            </section>
          )}

          {view === "home" && (
            <section className="how-it-works" aria-labelledby="how-it-works-title">
              <h2 id="how-it-works-title">{t("Cómo funciona")}</h2>
              <ol>
                <li>
                  <span className="how-step" aria-hidden="true">
                    1
                  </span>
                  <h3>{t("Comparte")}</h3>
                  <p>{t("Publica un libro que ya hayas leído y deja que otros lo encuentren.")}</p>
                </li>
                <li>
                  <span className="how-step" aria-hidden="true">
                    2
                  </span>
                  <h3>{t("Encuentra")}</h3>
                  <p>{t("Pide el ejemplar que buscas: quien lo tiene decide si te lo pasa.")}</p>
                </li>
                <li>
                  <span className="how-step" aria-hidden="true">
                    3
                  </span>
                  <h3>{t("Sigue viajando")}</h3>
                  <p>
                    {t(
                      "Quedáis para la entrega, la confirmáis las dos partes y el libro sigue su camino.",
                    )}
                  </p>
                </li>
              </ol>
              <p className="how-note">
                {t(
                  "No hace falta que os cambiéis libros entre vosotros: lo que hoy das, mañana lo recibe otra persona de la comunidad.",
                )}
              </p>
            </section>
          )}

          <div className="section-heading">
            <div>
              {view === "home" ? (
                <h2>{t(VIEW_TITLES[view])}</h2>
              ) : (
                <h1 tabIndex={-1}>{t(VIEW_TITLES[view])}</h1>
              )}
            </div>
          </div>

          {filters.tag && (view === "discover" || view === "shelf") && (
            <p className="tag-filter-banner">
              {t("Mostrando libros con la etiqueta")} <strong>{filters.tag}</strong>
              <button
                type="button"
                className="inline-link"
                onClick={() => navigate({ tag: "", page: 1 })}
              >
                {t("Quitar filtro")}
              </button>
            </p>
          )}

          {view === "community" ? (
            <div className="community-hub">
              {/* Las secciones primero: son la navegación del hub y estaban
                  escondidas dentro de la tarjeta del muro, después de un
                  encabezado que repetía el nombre de la pestaña activa. */}
              <div
                className="community-tabs"
                role="tablist"
                aria-label={t("Contenido de la comunidad")}
                onKeyDown={onCommunityTabKeyDown}
              >
                {COMMUNITY_TABS_ORDER.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    id={`community-tab-${tab}`}
                    aria-controls="feed-panel"
                    aria-selected={filters.tab === tab}
                    tabIndex={filters.tab === tab ? 0 : -1}
                    className={filters.tab === tab ? "feed-tab active" : "feed-tab"}
                    onClick={() => navigate({ tab, page: 1 })}
                  >
                    {tab === "conversations" ? (
                      <MessageCircle size={14} />
                    ) : tab === "activity" ? (
                      <Activity size={14} />
                    ) : tab === "clubs" ? (
                      <BookOpen size={14} />
                    ) : tab === "readers" ? (
                      <Users size={14} />
                    ) : (
                      <Heart size={14} />
                    )}
                    {t(COMMUNITY_TAB_LABELS[tab])}
                  </button>
                ))}
              </div>
              <div className="community-toolbar">
                <p className="community-toolbar-note">
                  {filters.scope === "city" && user
                    ? t("Solo {city}", { city: user.city })
                    : filters.tab === "conversations"
                      ? filters.feed === "following"
                        ? t("Solo lo que publican las cuentas que sigues")
                        : t("Lo que la comunidad está leyendo y comentando")
                      : filters.tab === "activity"
                        ? t("Movimientos de la comunidad")
                        : filters.tab === "clubs"
                          ? t("Clubes de lectura para leer en compañía")
                          : filters.tab === "readers"
                            ? t("Personas activas con las que compartir lecturas")
                            : t("Listas de lectura que la comunidad comparte")}
                </p>
                <div className="feed-header-controls">
                  {user && (
                    <div className="feed-switch" role="group" aria-label={t("Ámbito de la comunidad")}>
                      <button
                        type="button"
                        className={
                          filters.scope === "region"
                            ? "feed-switch-option active"
                            : "feed-switch-option"
                        }
                        aria-pressed={filters.scope === "region"}
                        onClick={() => navigate({ scope: "region", page: 1 })}
                      >
                        {t("Toda Europa")}
                      </button>
                      <button
                        type="button"
                        className={
                          filters.scope === "city" ? "feed-switch-option active" : "feed-switch-option"
                        }
                        aria-pressed={filters.scope === "city"}
                        onClick={() => navigate({ scope: "city", page: 1 })}
                      >
                        {user.city}
                      </button>
                    </div>
                  )}
                  {user && (filters.tab === "conversations" || filters.tab === "activity") && (
                    <div className="feed-switch" role="group" aria-label={t("Filtrar el muro")}>
                      <button
                        type="button"
                        className={
                          filters.feed === "all" ? "feed-switch-option active" : "feed-switch-option"
                        }
                        aria-pressed={filters.feed === "all"}
                        onClick={() => navigate({ feed: "all", page: 1 })}
                      >
                        {t("Toda la comunidad")}
                      </button>
                      <button
                        type="button"
                        className={
                          filters.feed === "following" ? "feed-switch-option active" : "feed-switch-option"
                        }
                        aria-pressed={filters.feed === "following"}
                        onClick={() => navigate({ feed: "following", page: 1 })}
                      >
                        {t("Siguiendo")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <section className="activity-feed">
                <div
                  role="tabpanel"
                  id="feed-panel"
                  aria-labelledby={`community-tab-${filters.tab}`}
                  tabIndex={0}
                >
                {filters.tab === "conversations" && conversations.length === 0 && (
                  <p className="empty-note">
                    {filters.feed === "following" ? (
                      <>
                        {t("Aquí aparecerá lo que publiquen las cuentas que sigues.")}{" "}
                        <Link href="/lectores" className="inline-link">
                          {t("Encuentra lectores de tu región")}
                        </Link>
                        .
                      </>
                    ) : (
                      t("Todavía no hay conversaciones. Abre la primera desde la ficha de cualquier libro.")
                    )}
                  </p>
                )}
                {filters.tab === "conversations" &&
                  conversations.map((item) => (
                  <article className="conversation-item" key={item.id}>
                    <span className={`avatar activity-avatar tone-${toneForId(item.author.id)}`}>
                      {initialsOf(item.author.name)}
                    </span>
                    <div className="conversation-copy">
                      <p>
                        <strong>{item.author.name}</strong> {t("sobre")} <b>{item.bookTitle}</b>
                      </p>
                      <p className="conversation-excerpt">{item.excerpt}</p>
                      <span>
                        {formatWhen(item.createdAt, locale)} <i>·</i> {item.author.city} <i>·</i>{" "}
                        {item.replies === 1 ? t("1 respuesta") : t("{n} respuestas", { n: item.replies })}
                        {item.likes > 0 && ` · ${t("{n} me gusta", { n: item.likes })}`}
                      </span>
                    </div>
                    <Link
                      className="conversation-open"
                      href={`/obra/${item.bookId}#c-${item.id}`}
                      aria-label={t("Abrir la conversación sobre {title}", { title: item.bookTitle })}
                    >
                      <ArrowRight size={16} />
                    </Link>
                  </article>
                ))}

                {filters.tab === "activity" && activity.length === 0 && (
                  <p className="empty-note">{t("Todavía no hay actividad. Comparte el primer libro.")}</p>
                )}
                {filters.tab === "activity" &&
                  activity.map((item) => (
                  <article className="activity-item" key={item.id}>
                    <span className={`avatar activity-avatar tone-${toneForId(item.id)}`}>
                      {initialsOf(item.actor)}
                    </span>
                    <div className="activity-copy">
                      <p>
                        <strong>{item.actor}</strong> {t(ACTIVITY_COPY[item.type] ?? item.type)}{" "}
                        <b>{item.title}</b>
                      </p>
                      <span>
                        {formatWhen(item.createdAt, locale)} <i>·</i>{" "}
                        <Link href={`/libro/${item.listingId}`} className="inline-link">
                          {t("ver el ejemplar")}
                        </Link>
                      </span>
                    </div>
                  </article>
                ))}

                {filters.tab === "clubs" && (
                  <div className="community-section">
                    {user && (
                      <div className="community-clubs-tools">
                        <ClubBoard defaultCity={user.city} />
                      </div>
                    )}
                    {clubs.length === 0 ? (
                      <div className="community-empty">
                        <h3>
                          {t("Todavía no hay clubes")}
                          {filters.scope === "city" && user ? ` ${user.city}` : ""}
                        </h3>
                        <p>{t("Crea el primero y propón una lectura para empezar.")}</p>
                      </div>
                    ) : (
                      <div className="community-club-grid">
                        {clubs.map((club) => (
                          <ClubCard key={club.id} club={club} compact />
                        ))}
                      </div>
                    )}
                    <Link href="/clubes" className="community-more">
                      {clubsTotal > clubs.length
                        ? t("Ver los {n} clubes", { n: clubsTotal })
                        : t("Ir al directorio de clubes")}{" "}
                      <ArrowRight size={15} />
                    </Link>
                  </div>
                )}

                {filters.tab === "readers" && (
                  <div className="community-section">
                    {readers.length === 0 ? (
                      <div className="community-empty">
                        <h3>{t("Todavía no hay lectores que mostrar")}</h3>
                        <p>{t("Publica un libro o abre una conversación para aparecer aquí.")}</p>
                      </div>
                    ) : (
                      <div className="reader-list community-readers">
                        {readers.map((reader) => (
                          <ReaderCard
                            key={reader.user.id}
                            reader={reader}
                            isAuthenticated={Boolean(user) && user?.id !== reader.user.id}
                          />
                        ))}
                      </div>
                    )}
                    <Link href="/lectores" className="community-more">
                      {t("Ver {n} lectores", { n: readersTotal })}{" "}
                      <ArrowRight size={15} />
                    </Link>
                  </div>
                )}

                {filters.tab === "lists" && (
                  <div className="community-section">
                    {publicLists.length === 0 ? (
                      <div className="community-empty">
                        <h3>{t("Sin listas públicas todavía")}</h3>
                        <p>
                          {t(
                            "Crea una lista desde la ficha de cualquier libro y compártela con la comunidad.",
                          )}
                        </p>
                      </div>
                    ) : (
                      <ul className="community-lists">
                        {publicLists.map((list) => (
                          <li key={list.id}>
                            <Link href={`/listas/${list.id}`} className="community-list-card">
                              <strong>{list.title}</strong>
                              <span>
                                {list.owner.name} ·{" "}
                                {list.items === 1 ? t("1 obra") : t("{n} obras", { n: list.items })}
                              </span>
                              {list.description && <p>{list.description}</p>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link href="/listas" className="community-more">
                      {t("Todas las listas")} <ArrowRight size={15} />
                    </Link>
                  </div>
                )}
                </div>
              </section>
            </div>
          ) : view === "offer" ? (
            /* Publicar un libro, en su página: mismo shell y misma cabecera
               que el resto de vistas, pero con URL propia. */
            <section className="offer-page">
              <p className="offer-intro">
                {t("Escribe el ISBN y el resto de la ficha se rellena sola.")}
              </p>
              <OfferForm
                defaultCity={user?.city ?? ""}
                onCreated={(demand) => {
                  refresh();
                  notify(
                    demand === 1
                      ? t("Tu libro ya está en la comunidad y hay 1 persona esperándolo en tu ciudad.")
                      : demand > 1
                        ? t("Tu libro ya está en la comunidad y hay {n} personas esperándolo en tu ciudad.", {
                            n: demand,
                          })
                        : t("Tu libro ya está en la estantería de la comunidad."),
                  );
                  navigate({ view: "shelf", page: 1 });
                }}
              />
            </section>
          ) : view === "exchanges" ? (
            !user ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <ArrowDownUp size={24} />
                </span>
                <h3>{t("Entra para ver tus intercambios")}</h3>
                <p>{t("Las solicitudes quedan ligadas a tu cuenta y se sincronizan en tus dispositivos.")}</p>
                <button type="button" className="share-button" onClick={() => setAuthOpen(true)}>
                  {t("Entrar")} <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <ExchangesList
                requests={requests}
                onOpen={setExchangeId}
                onExplore={() => navigate({ view: "discover" })}
              />
            )
          ) : (
            <>
              {view === "shelf" && user && (
                <div className="shelf-tabs" role="group" aria-label={t("Filtrar estantería")}>
                  {([
                    ["all", "Todo"],
                    ["saved", "Guardados"],
                    ["mine", "Mis publicaciones"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={filters.shelf === value}
                      className={filters.shelf === value ? "category-tab selected" : "category-tab"}
                      onClick={() => navigate({ shelf: value, page: 1 })}
                    >
                      {t(label)}
                    </button>
                  ))}
                </div>
              )}
              <div className="discovery-tools" hidden={view === "home"}>
                <div className="category-tabs" role="group" aria-label={t("Filtrar por género")}>
                  {["Todos", ...CATEGORIES].map((category) => (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={filters.category === category}
                      className={
                        filters.category === category ? "category-tab selected" : "category-tab"
                      }
                      onClick={() => navigate({ category, page: 1 })}
                    >
                      {t(category)}
                    </button>
                  ))}
                </div>
                <div className="filter-toolbar">
                  <div className="search-field">
                    <Search size={15} aria-hidden="true" />
                    <label className="sr-only" htmlFor="catalog-search">
                      {t("Buscar libros por título, autor o ciudad")}
                    </label>
                    <input
                      id="catalog-search"
                      placeholder={t("Título, autor o ciudad")}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    {search && (
                      <button
                        type="button"
                        className="search-clear"
                        aria-label={t("Limpiar búsqueda")}
                        onClick={() => {
                          setSearch("");
                          navigate({ q: "", page: 1 });
                        }}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <span className="result-count" role="status" aria-live="polite">
                    {total} {total === 1 ? t("libro") : t("libros")}
                  </span>
                  <div className="sort-select">
                    <label className="sr-only" htmlFor="catalog-sort">
                      {t("Ordenar libros")}
                    </label>
                    <select
                      id="catalog-sort"
                      value={sortValue}
                      onChange={(event) => navigate({ sort: event.target.value, page: 1 })}
                    >
                      {visibleSorts.map((sort) => (
                        <option key={sort} value={sort}>
                          {t(SORT_LABELS[sort])}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} aria-hidden="true" />
                  </div>
                </div>
                <button
                  type="button"
                  className="filters-toggle"
                  aria-expanded={filtersOpen}
                  aria-controls="catalog-secondary-filters"
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <SlidersHorizontal size={15} aria-hidden="true" />
                  {t("Filtros")}
                  {activeFilters > 0 && <span className="filters-count">{activeFilters}</span>}
                  <ChevronDown size={14} aria-hidden="true" className="filters-chevron" />
                </button>
                <div
                  className={filtersOpen ? "filter-secondary is-open" : "filter-secondary"}
                  id="catalog-secondary-filters"
                >
                  {user && user.city && (
                    <div className="radius-filter" role="group" aria-label={t("Distancia desde tu ciudad")}>
                      <MapPin size={14} aria-hidden="true" />
                      <span>{t("Distancia")}</span>
                      {RADIUS_OPTIONS.map((radius) => (
                        <button
                          key={radius}
                          type="button"
                          aria-pressed={filters.radius === radius}
                          className={
                            filters.radius === radius ? "filter-chip selected" : "filter-chip"
                          }
                          onClick={() => navigate({ radius, page: 1 })}
                        >
                          {radius === 0
                            ? t("Sin límite")
                            : t("Hasta {n} km", { n: radius })}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="language-filter">
                    <label className="sr-only" htmlFor="catalog-language">
                      {t("Idioma del libro")}
                    </label>
                    <select
                      id="catalog-language"
                      value={filters.language}
                      onChange={(event) => navigate({ language: event.target.value, page: 1 })}
                    >
                      {CATALOG_LANGUAGES.map((language) => (
                        <option key={language} value={language}>
                          {language === "Todos" ? t("Todos los idiomas") : t(language)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} aria-hidden="true" />
                  </div>
                </div>
                {(filters.q || filters.tag) && (
                  <div className="active-filters">
                    {filters.q && (
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() => {
                          setSearch("");
                          navigate({ q: "", page: 1 });
                        }}
                      >
                        {t("Búsqueda: {value}", { value: filters.q })} <X size={12} />
                      </button>
                    )}
                    {filters.tag && (
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() => navigate({ tag: "", page: 1 })}
                      >
                        {t(filters.tag)} <X size={12} />
                      </button>
                    )}
                    <button type="button" className="inline-link" onClick={clearFilters}>
                      {t("Limpiar filtros")}
                    </button>
                  </div>
                )}
              </div>

              <div
                className={view === "home" ? "book-grid home-grid" : "book-grid"}
                id="book-grid"
                aria-busy={isPending || undefined}
              >
                {isPending &&
                  listings.length === 0 &&
                  Array.from({ length: 8 }, (_, index) => (
                    <div className="skeleton-card" key={index} aria-hidden="true">
                      <div className="skeleton-cover" />
                      <div className="skeleton-body">
                        <span className="skeleton-line short" />
                        <span className="skeleton-line" />
                        <span className="skeleton-line medium" />
                      </div>
                    </div>
                  ))}
                <div className={isPending ? "book-grid-content is-pending" : "book-grid-content"}>
                {listings.map((listing) => {
                  const favorite = isFavorite(listing.id, listing.isFavorite);
                  return (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      onPreview={user ? undefined : () => setPreviewListing(listing)}
                      actions={
                        <button
                          type="button"
                          className={favorite ? "favorite-button is-favorite" : "favorite-button"}
                          aria-pressed={favorite}
                          aria-label={
                            favorite
                              ? t("Quitar {title} de mi estantería", { title: listing.title })
                              : t("Guardar {title} en mi estantería", { title: listing.title })
                          }
                          // `disabled` quitaría el foco al botón mientras se
                          // guarda; se marca como ocupado y se ignora el clic.
                          aria-disabled={busyFavorite === listing.id || undefined}
                          onClick={() => {
                            if (busyFavorite === listing.id) return;
                            toggleFavorite(listing.id, favorite);
                          }}
                        >
                          <Heart size={17} fill={favorite ? "currentColor" : "none"} />
                        </button>
                      }
                    />
                  );
                })}

                {listings.length === 0 && (
                  <EmptyState
                    icon={<BookOpen size={24} />}
                    title={
                      view === "shelf" && !user
                        ? t("Entra para guardar tu estantería")
                        : t("No encontramos libros por aquí.")
                    }
                    hint={
                      view === "shelf" && !user
                        ? t("Inicia sesión para conservar tus favoritos y publicaciones.")
                        : t("Prueba con otro título, autor o género.")
                    }
                    action={
                      view === "shelf" && !user ? (
                      <button type="button" className="share-button small" onClick={() => setAuthOpen(true)}>
                        {t("Entrar")}
                      </button>
                      ) : (
                        <button
                          type="button"
                          className="share-button small"
                          onClick={() => {
                            setSearch("");
                            navigate({ q: "", category: "Todos", page: 1 });
                          }}
                        >
                          {t("Limpiar filtros")}
                        </button>
                      )
                    }
                  />
                )}
                </div>
              </div>

              {view === "home" && (
                <div className="home-discover">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      navigate({ view: "discover", page: 1 });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <Compass size={16} /> {t("Descubrir todos los libros")}
                  </button>
                </div>
              )}

              {(view === "discover" || view === "shelf") && total > pageSize && (
                <nav className="pager" aria-label={t("Paginación")}>
                  <button
                    type="button"
                    className="secondary-button small"
                    disabled={page <= 1 || isPending}
                    onClick={() => navigate({ page: page - 1 })}
                  >
                    <ChevronLeft size={15} /> {t("Anterior")}
                  </button>
                  <span>
                    {t("Mostrando {from}–{to} de {total}", {
                      from: (page - 1) * pageSize + 1,
                      to: Math.min(page * pageSize, total),
                      total,
                    })}
                    {" · "}
                    {t("Página")} {page}/{lastPage}
                  </span>
                  <button
                    type="button"
                    className="secondary-button small"
                    disabled={!hasMore || isPending}
                    onClick={() => navigate({ page: page + 1 })}
                  >
                    {t("Siguiente")} <ChevronRight size={15} />
                  </button>
                </nav>
              )}
            </>
          )}

          <footer className="page-footer">
            <span>{t("Hecho para que las historias sigan viajando.")}</span>
            {user && (
              <nav className="footer-links" aria-label={t("Secciones de la comunidad")}>
                <Link href="/clubes">{t("Clubes")}</Link>
                <Link href="/lectores">{t("Lectores")}</Link>
                <Link href="/listas">{t("Listas")}</Link>
              </nav>
            )}
            {/* Sin sesión también: la política de privacidad hay que poder
                leerla antes de crear la cuenta, y la documentación técnica
                antes de desplegar la instancia. */}
            <nav
              className="footer-links legal-links"
              aria-label={t("Información y documentación")}
            >
              <Link href="/descubrir">{t("Descubrir todos los libros")}</Link>
              <Link href="/privacidad">{t("Privacidad")}</Link>
              <Link href="/aviso-legal">{t("Aviso legal")}</Link>
              <Link href="/projekt">{t("El proyecto")}</Link>
              <Link href="/documentacion">{t("Documentación")}</Link>
            </nav>
            <span>
              <i className="footer-dot" /> {t("Comunidad abierta")} · {stats.cities}{" "}
              {t("ciudades de")} {REGION}
            </span>
          </footer>
        </div>
      </section>

      {user && (
      <div className="mobile-bottom-nav" role="navigation" aria-label={t("Navegación móvil")}>
        <button
          type="button"
          className={
            view === "home" || view === "discover" ? "mobile-active" : ""
          }
          aria-current={view === "home" || view === "discover" ? "page" : undefined}
          onClick={() => navigate({ view: "discover", page: 1 })}
        >
          <Compass size={19} />
          <span>{t("Descubrir")}</span>
        </button>
        <button
          type="button"
          className={view === "shelf" ? "mobile-active" : ""}
          aria-current={view === "shelf" ? "page" : undefined}
          aria-label={user ? undefined : t("Entra para ver tu estantería")}
          onClick={() => (requireAuth() ? navigate({ view: "shelf", page: 1 }) : undefined)}
        >
          <Heart size={19} />
          <span>{t("Estantería")}</span>
        </button>
        <button
          type="button"
          className={view === "offer" ? "mobile-add mobile-active" : "mobile-add"}
          aria-current={view === "offer" ? "page" : undefined}
          aria-label={t("Ofrecer un libro")}
          onClick={openOffer}
        >
          <span className="mobile-add-icon" aria-hidden="true">
            <Plus size={18} />
          </span>
          <span>{t("Ofrecer")}</span>
        </button>
        <button
          type="button"
          className={view === "exchanges" ? "mobile-active" : ""}
          aria-current={view === "exchanges" ? "page" : undefined}
          aria-label={user ? undefined : t("Entra para ver tus intercambios")}
          onClick={() => (requireAuth() ? navigate({ view: "exchanges", page: 1 }) : undefined)}
        >
          <ArrowDownUp size={19} />
          {/* En la barra inferior el hueco es de ~58 px: «Intercambios» no cabe
              y se partía por la mitad. El nombre completo sigue en la barra
              lateral y en el breadcrumb. */}
          <span>{t("Cambios")}</span>
        </button>
        <button
          type="button"
          className={view === "community" ? "mobile-active" : ""}
          aria-current={view === "community" ? "page" : undefined}
          aria-label={user ? undefined : t("Entra para participar en la comunidad")}
          onClick={() => (requireAuth() ? navigate({ view: "community", page: 1 }) : undefined)}
        >
          <Users size={19} />
          <span>{t("Comunidad")}</span>
        </button>
      </div>
      )}

      {toast && (
        <div
          className={toast.tone === "error" ? "toast toast-error" : "toast"}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          {toast.tone === "error" ? <TriangleAlert size={17} /> : <Check size={17} />}
          {toast.message}
          <button type="button" aria-label={t("Cerrar aviso")} onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}

      {authOpen && (
        <AuthDialog
        open={authOpen}
        onClose={() => {
          pendingFavorite.current = null;
          setAuthOpen(false);
          setAuthNext(null);
          clearQueryParams("auth", "offer");
        }}
        onSuccess={() => {
          const target = authNext ?? nextPath;
          const pending = pendingFavorite.current;
          pendingFavorite.current = null;
          refresh();
          notify(t("Sesión iniciada. ¡Buena lectura!"));
          if (pending) {
            void api(`/api/listings/${pending.id}/favorite`, {
              method: "POST",
              body: { favorite: pending.favorite },
            })
              .then(() => {
                setFavoriteOverrides((overrides) => ({ ...overrides, [pending.id]: pending.favorite }));
                notify(
                  pending.favorite
                    ? t("Guardado en tu estantería.")
                    : t("Quitado de tu estantería."),
                );
                refresh();
              })
              .catch(() => notify(t("No se pudo actualizar tu estantería."), "error"));
          }
          if (target) router.push(target);
        }}
        />
      )}

      <ListingPreview
        listing={previewListing}
        onClose={() => setPreviewListing(null)}
        onLogin={() => {
          if (!previewListing) return;
          setAuthNext(`/libro/${previewListing.id}`);
          setPreviewListing(null);
          setAuthOpen(true);
        }}
      />

      {notificationsOpen && (
        <NotificationsDialog
          open={notificationsOpen}
        onClose={() => {
          setNotificationsOpen(false);
          clearQueryParams("notifications");
        }}
        notifications={notifications}
        unread={unreadNotifications}
        onMarkRead={markNotificationsRead}
        onRefresh={refresh}
        />
      )}

      {exchangeRequest && (
        <ExchangeDialog
          open
          onClose={() => setExchangeId(null)}
          request={exchangeRequest}
          onChanged={refresh}
        />
      )}
    </main>
  );
}
