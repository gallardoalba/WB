import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  Activity,
  Award,
  BookOpen,
  MessageCircle,
  UserPlus,
  Users,
} from "lucide-react";
import { ListingCard } from "@/components/listing-card";
import { ProfileActions } from "@/components/profile-actions";
import { ReviewList } from "@/components/review-list";
import { SiteShell } from "@/components/site-shell";
import { requirePageUser } from "@/lib/page-auth";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import type { MessageKey } from "@/lib/i18n";
import { localeTag, pick } from "@/lib/locale";
import { socialMetadata } from "@/lib/social";
import { ReaderCard } from "@/components/reader-card";
import {
  getPublicProfile,
  getReaderJourney,
  listAuthorComments,
  listFollowEdges,
  listReadingLists,
  listReviews,
  listUserActivity,
  mutualFollow,
} from "@/lib/repo";
import { formatNumber, formatWhen, initialsOf, toneForId } from "@/lib/text";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const instant = false;

const ACTIVITY_COPY: Record<string, MessageKey> = {
  published: "ha compartido",
  requested: "ha solicitado",
  accepted: "ha aceptado un intercambio de",
  completed: "ha completado un intercambio de",
};

const TABS = ["shelf", "activity", "comments", "followers", "following"] as const;
type Tab = (typeof TABS)[number];

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const locale = await getLocale();
  const profile = getPublicProfile(id, null);
  if (!profile) {
    // Un perfil que no existe responde en streaming (200 + esta página), así
    // que el «no indexar» tiene que venir en los metadatos, no en el estado.
    return {
      title: pick(locale, {
        es: "Perfil no encontrado",
        de: "Profil nicht gefunden",
        en: "Profile not found",
      }),
      robots: { index: false, follow: false },
    };
  }
  return {
    title: profile.user.name,
    description: pick(locale, {
      es: `${profile.published} libros compartidos por ${profile.user.name} en ${profile.user.city}.`,
      de: `${profile.published} geteilte Bücher von ${profile.user.name} in ${profile.user.city}.`,
      en: `${profile.published} shared books by ${profile.user.name} in ${profile.user.city}.`,
    }),
    alternates: { canonical: `/u/${profile.user.id}` },
    ...socialMetadata({
      locale,
      path: `/u/${profile.user.id}`,
      title: pick(locale, {
        es: `${profile.user.name} en Wanderbibliothek`,
        de: `${profile.user.name} auf Wanderbibliothek`,
        en: `${profile.user.name} on Wanderbibliothek`,
      }),
      description: pick(locale, {
        es: `Comparte libros con ${profile.user.name} en ${profile.user.city}.`,
        de: `Teile Bücher mit ${profile.user.name} in ${profile.user.city}.`,
        en: `Share books with ${profile.user.name} in ${profile.user.city}.`,
      }),
      type: "profile",
    }),
  };
}

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const raw = await searchParams;
  const rawPage = Array.isArray(raw.page) ? raw.page[0] : raw.page;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const showAllReviews = raw.reviews === "all";
  const rawTab = firstValue(raw.tab);
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "shelf";

  const viewer = await requirePageUser(`/u/${id}`);
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  const profile = getPublicProfile(id, viewer?.id ?? null, { page });
  if (!profile) notFound();
  // Mensajería directa solo entre seguidores mutuos (y sin bloqueos).
  const canMessage =
    Boolean(viewer) && !profile.isMe && mutualFollow(viewer!.id, profile.user.id);
  const openMessages = firstValue(raw.dm) === "1";

  const memberSince = new Intl.DateTimeFormat(localeTag(locale), {
    month: "long",
    year: "numeric",
  }).format(new Date(profile.memberSince));

  const REVIEW_PAGE = 10;
  const reviews = listReviews(
    profile.user.id,
    showAllReviews ? 100 : REVIEW_PAGE + 1,
    viewer?.id ?? null,
  );
  const hasMoreReviews = !showAllReviews && reviews.length > REVIEW_PAGE;
  const visibleReviews = showAllReviews ? reviews : reviews.slice(0, REVIEW_PAGE);

  const commentViewer = viewer ? { id: viewer.id, isAdmin: viewer.isAdmin } : null;
  const activity = tab === "activity" ? listUserActivity(profile.user.id) : [];
  const comments = tab === "comments" ? listAuthorComments(profile.user.id, commentViewer) : [];
  const lists = tab === "shelf" ? listReadingLists(profile.user.id, viewer?.id ?? null) : [];
  const edges =
    tab === "followers" || tab === "following"
      ? listFollowEdges(profile.user.id, tab, viewer?.id ?? null)
      : [];
  const journey = getReaderJourney(profile.user.id);
  const earned = journey.badges.filter((badge) => badge.earned);
  const name = profile.user.name.split(" ")[0] ?? profile.user.name;

  return (
    <SiteShell user={viewer} section="perfil" title={profile.user.name}>
      <section className="profile-hero">
        <span className={`avatar profile-avatar tone-${toneForId(profile.user.id)}`}>
          {initialsOf(profile.user.name)}
        </span>
        <div className="profile-hero-copy">
          <h1>
            {profile.user.name}
            {profile.user.isTeam && <span className="team-badge">{t("Equipo")}</span>}
          </h1>
          <p>{profile.user.bio || t("Sin biografía todavía.")}</p>
          <span className="profile-place">
            {profile.user.city} · {t("En Wanderbibliothek desde {date}", { date: memberSince })}
          </span>
        </div>
        <dl className="profile-metrics">
          <div>
            <dt>{t("Publicados")}</dt>
            <dd>{profile.published}</dd>
          </div>
          <div>
            <dt>{t("Completados")}</dt>
            <dd>{profile.completed}</dd>
          </div>
          <div>
            <dt>{t("Comentarios")}</dt>
            <dd>{profile.comments}</dd>
          </div>
          <div>
            <dt>{t("Seguidores")}</dt>
            <dd>{profile.followers}</dd>
          </div>
          <div>
            <dt>{t("Siguiendo")}</dt>
            <dd>{profile.following}</dd>
          </div>
          <div>
            <dt>{t("Valoración")}</dt>
            <dd>
              {profile.ratingAverage === null ? "—" : `${profile.ratingAverage} / 5`}
              {profile.ratingCount > 0 && <small className="rating-count"> ({profile.ratingCount})</small>}
            </dd>
          </div>
        </dl>
      </section>

      <ProfileActions
        userId={profile.user.id}
        userName={profile.user.name}
        isBlocked={profile.isBlocked}
        isFollowing={profile.isFollowing}
        followers={profile.followers}
        isAuthenticated={Boolean(viewer) && !profile.isMe}
        canFollow={Boolean(viewer) && !profile.isMe && !profile.isBlocked}
        canMessage={canMessage}
        openMessages={openMessages}
      />

      <section className="profile-journey" aria-labelledby="journey-title">
        <div className="journey-head">
          <div>
            <h2 id="journey-title">{t("Lo que han hecho estos libros")}</h2>
          </div>
          <span className="shelf-count">
            {t("{n} de {total} insignias", { n: earned.length, total: journey.badges.length })}
          </span>
        </div>
        <dl className="journey-stats">
          <div>
            <dt>{t("Libros pasados")}</dt>
            <dd>{journey.given}</dd>
          </div>
          <div>
            <dt>{t("Libros recibidos")}</dt>
            <dd>{journey.received}</dd>
          </div>
          <div>
            <dt>{t("Kilómetros recorridos")}</dt>
            <dd>{formatNumber(journey.km, locale)} km</dd>
          </div>
          <div>
            <dt>{t("Ciudades")}</dt>
            <dd>{journey.cities}</dd>
          </div>
        </dl>
        {/* Solo las conseguidas: las pendientes eran ruido y desvelaban
            los objetivos vacíos del perfil. El contador de arriba mantiene la
            cuenta («2 de 7 insignias»). */}
        {earned.length > 0 ? (
          <ul className="badge-list">
            {earned.map((badge) => (
              <li key={badge.id} className="badge earned">
                <span className="badge-label">
                  <Award size={14} /> {t(badge.label)}
                </span>
                <small className="badge-hint">{t(badge.hint)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="badge-empty">
            {t("Todavía no hay insignias: se consiguen intercambiando y participando en la comunidad.")}
          </p>
        )}
      </section>

      <nav className="profile-tabs" aria-label={t("Secciones del perfil")}>
        <Link
          href={`/u/${profile.user.id}`}
          className={tab === "shelf" ? "profile-tab active" : "profile-tab"}
          aria-current={tab === "shelf" ? "page" : undefined}
        >
          <BookOpen size={14} /> {t("Estantería")}
        </Link>
        <Link
          href={`/u/${profile.user.id}?tab=activity`}
          className={tab === "activity" ? "profile-tab active" : "profile-tab"}
          aria-current={tab === "activity" ? "page" : undefined}
        >
          <Activity size={14} /> {t("Muro")}
        </Link>
        <Link
          href={`/u/${profile.user.id}?tab=comments`}
          className={tab === "comments" ? "profile-tab active" : "profile-tab"}
          aria-current={tab === "comments" ? "page" : undefined}
        >
          <MessageCircle size={14} /> {t("Conversaciones")}
        </Link>
        <Link
          href={`/u/${profile.user.id}?tab=followers`}
          className={tab === "followers" ? "profile-tab active" : "profile-tab"}
          aria-current={tab === "followers" ? "page" : undefined}
        >
          <Users size={14} /> {t("Seguidores")} ({profile.followers})
        </Link>
        <Link
          href={`/u/${profile.user.id}?tab=following`}
          className={tab === "following" ? "profile-tab active" : "profile-tab"}
          aria-current={tab === "following" ? "page" : undefined}
        >
          <UserPlus size={14} /> {t("Siguiendo")} ({profile.following})
        </Link>
        <Link href="/lectores" className="profile-tab">
          <Users size={14} /> {t("Lectores")}
        </Link>
      </nav>

      {tab === "shelf" && (
      <section className="profile-shelf">
        <div className="section-heading">
          <div>
            <h2>{t("Libros de {name}", { name: profile.user.name.split(" ")[0] })}</h2>
          </div>
          <span className="shelf-count">
            {profile.listingsTotal === 1
              ? t("1 ejemplar")
              : t("{n} ejemplares", { n: profile.listingsTotal })}
          </span>
        </div>

        {profile.listings.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">
              <BookOpen size={22} />
            </span>
            <h3>{t("Sin libros publicados")}</h3>
            <p>{t("Cuando comparta un ejemplar aparecerá aquí.")}</p>
          </div>
        ) : (
          <>
            <div className="book-grid">
              {profile.listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
            {(profile.page > 1 || profile.hasMoreListings) && (
              <nav className="pager" aria-label={t("Paginación de la estantería")}>
                {profile.page <= 1 ? (
                  <span className="secondary-button small is-disabled" aria-disabled="true">
                    {t("Anterior")}
                  </span>
                ) : (
                  <Link
                    className="secondary-button small"
                    href={`/u/${profile.user.id}?page=${profile.page - 1}`}
                  >
                    {t("Anterior")}
                  </Link>
                )}
                <span>{t("Página {n}", { n: profile.page })}</span>
                {profile.hasMoreListings ? (
                  <Link
                    className="secondary-button small"
                    href={`/u/${profile.user.id}?page=${profile.page + 1}`}
                  >
                    {t("Siguiente")}
                  </Link>
                ) : (
                  <span className="secondary-button small is-disabled" aria-disabled="true">
                    {t("Siguiente")}
                  </span>
                )}
              </nav>
            )}
          </>
        )}
      </section>      )}

      {tab === "activity" && (
        <section className="profile-shelf">
          <div className="section-heading">
            <div>
              <h2>{t("Lo último de {name}", { name })}</h2>
            </div>
          </div>
          {activity.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">
                <Activity size={22} />
              </span>
              <h3>{t("Sin actividad todavía")}</h3>
              <p>{t("Sus publicaciones e intercambios aparecerán aquí.")}</p>
            </div>
          ) : (
            <div className="activity-feed">
              {activity.map((item) => (
                <article className="activity-item" key={item.id}>
                  <span className={`avatar activity-avatar tone-${toneForId(item.id)}`}>
                    {initialsOf(profile.user.name)}
                  </span>
                  <div className="activity-copy">
                    <p>
                      {t(ACTIVITY_COPY[item.type] ?? item.type)} <b>{item.title}</b>
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
            </div>
          )}
        </section>
      )}

      {tab === "comments" && (
        <section className="profile-shelf">
          <div className="section-heading">
            <div>
              <h2>{t("Cómo lee {name}", { name })}</h2>
            </div>
            <span className="shelf-count">{profile.comments}</span>
          </div>
          {comments.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">
                <MessageCircle size={22} />
              </span>
              <h3>{t("Sin comentarios todavía")}</h3>
              <p>{t("Cuando opine sobre un libro lo verás aquí.")}</p>
            </div>
          ) : (
            <div className="conversation-list">
              {comments.map((item) => (
                <article className="conversation-item" key={item.id}>
                  <div className="conversation-copy">
                    <p>
                      {t("sobre")} <b>{item.bookTitle}</b>
                    </p>
                    <p className="conversation-excerpt">{item.excerpt}</p>
                    <span>
                      {formatWhen(item.createdAt, locale)} <i>·</i>{" "}
                      {item.replies === 1 ? t("1 respuesta") : t("{n} respuestas", { n: item.replies })}
                      {item.likes > 0 && ` · ${t("{n} me gusta", { n: item.likes })}`}
                    </span>
                  </div>
                  <Link
                    className="conversation-open"
                    href={`/obra/${item.bookId}#c-${item.id}`}
                    aria-label={t("Abrir la conversación sobre {title}", { title: item.bookTitle })}
                  >
                    <MessageCircle size={16} />
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {(tab === "followers" || tab === "following") && (
        <section className="profile-shelf">
          <div className="section-heading">
            <div>

              <h2>
                {tab === "followers" ? t("Quién sigue a") : t("A quién sigue")} {name}
              </h2>
            </div>
            <span className="shelf-count">{edges.length}</span>
          </div>
          {edges.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">
                <Users size={22} />
              </span>
              <h3>
                {tab === "followers" ? t("Todavía no tiene seguidores") : t("Todavía no sigue a nadie")}
              </h3>
              <p>{t("Las personas que compartan tus gustos aparecerán aquí.")}</p>
            </div>
          ) : (
            <div className="reader-list">
              {edges.map((edge) => (
                <ReaderCard
                  key={edge.user.id}
                  reader={edge}
                  isAuthenticated={Boolean(viewer)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "shelf" && lists.length > 0 && (
        <section className="profile-shelf">
          <div className="section-heading">
            <div>
              <h2>{t("Lo que recomienda {name}", { name })}</h2>
            </div>
            <span className="shelf-count">{lists.length}</span>
          </div>
          <div className="list-grid">
            {lists.map((list) => (
              <Link key={list.id} href={`/listas/${list.id}`} className="list-card">
                <strong>{list.title}</strong>
                <span>{list.items === 1 ? t("1 libro") : t("{n} libros", { n: list.items })}</span>
                {list.description && <p>{list.description}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="profile-shelf">
        <div className="section-heading">
          <div>
            <h2>{t("Qué dicen quienes han intercambiado con {name}", { name: profile.user.name.split(" ")[0] })}</h2>
          </div>
          <span className="shelf-count">{profile.ratingCount}</span>
        </div>
        <ReviewList
          reviews={visibleReviews}
          targetName={profile.user.name.split(" ")[0] ?? profile.user.name}
          canReport={Boolean(viewer) && !profile.isMe}
          viewerId={viewer?.id ?? null}
        />
        {hasMoreReviews && (
          <Link
            className="secondary-button small load-more"
            href={`/u/${profile.user.id}?reviews=all`}
          >
            {t("Ver las {count} valoraciones", { count: profile.ratingCount })}
          </Link>
        )}
      </section>
    </SiteShell>
  );
}
