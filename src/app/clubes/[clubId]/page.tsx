import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";
import { BookOpen, CalendarClock, Link2, Lock, Users } from "lucide-react";
import {
  ClubAttendance,
  ClubJoin,
  ClubMembersMenu,
  ClubReport,
  ClubReports,
  ClubRequests,
  ClubSettings,
  ClubShare,
} from "@/components/club-board";
import { ClubForum } from "@/components/club-forum";
import { ClubPoll } from "@/components/club-poll";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { requirePageUser } from "@/lib/page-auth";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { pick } from "@/lib/locale";
import {
  getActiveClubPoll,
  getClub,
  listClubMeetingHistory,
  listClubMembers,
  listClubPostReports,
  listClubPosts,
  listClubReadingStates,
  listClubRequests,
  listFollowEdges,
  listingsForBook,
  recordClubView,
} from "@/lib/repo";
import { formatMeeting, formatWhen, initialsOf, toneForId } from "@/lib/text";

type PageProps = {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const instant = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { clubId } = await params;
  const locale = await getLocale();
  const club = getClub(clubId, null);
  if (!club) {
    return {
      title: pick(locale, {
        es: "Club no encontrado",
        de: "Lesekreis nicht gefunden",
        en: "Club not found",
      }),
    };
  }
  return {
    title: club.name,
    description: pick(locale, {
      es: `Club de lectura en ${club.city}${club.book ? `, leyendo «${club.book.title}»` : ""}.`,
      de: `Lesekreis in ${club.city}${club.book ? `, liest «${club.book.title}»` : ""}.`,
      en: `Reading club in ${club.city}${club.book ? `, reading «${club.book.title}»` : ""}.`,
    }),
    alternates: { canonical: `/clubes/${club.id}` },
  };
}

export default async function Page({ params, searchParams }: PageProps) {
  const { clubId } = await params;
  const raw = await searchParams;
  const membersPage = Math.max(
    1,
    Number.parseInt(
      Array.isArray(raw.membersPage) ? (raw.membersPage[0] ?? "1") : (raw.membersPage ?? "1"),
      10,
    ) || 1,
  );

  const viewer = await requirePageUser(`/clubes/${clubId}`);
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  const club = getClub(clubId, viewer?.id ?? null);
  if (!club) notFound();

  // La visita es una escritura: se registra después de responder. En dev se
  // deja en el render porque `after()` dispara un diagnóstico de Next.
  if (viewer) {
    if (process.env.NODE_ENV === "production") {
      after(() => {
        try {
          recordClubView(club.id, viewer.id);
        } catch (error) {
          console.error("[clubs] no se pudo registrar la visita", error);
        }
      });
    } else {
      recordClubView(club.id, viewer.id);
    }
  }

  // La lista de miembros no se envía a quien no está en el club: la privacidad
  // se decide aquí, no escondiendo el HTML con CSS.
  const members = club.isMember
    ? listClubMembers(club.id, { page: membersPage, pageSize: 24 })
    : null;
  // El menú de gestión necesita a todo el club, no solo a la página visible.
  const todos = club.isMine ? listClubMembers(club.id, { pageSize: 100 }) : null;
  // Lo lleva el dueño y, desde la v34, sus moderadores.
  const llevaElClub = club.isMine || club.isModerator;
  const requests = llevaElClub && viewer ? listClubRequests(club.id, viewer.id) : [];
  // Moderación del club: mensajes del foro denunciados. Antes esto solo lo veía
  // la administración.
  const denuncias = llevaElClub && viewer ? listClubPostReports(club.id, viewer.id) : [];
  const following =
    viewer && club.isMember
      ? listFollowEdges(viewer.id, "following", viewer.id)
          .filter((reader) => !reader.isMe)
          .map((reader) => ({ id: reader.user.id, name: reader.user.name }))
      : [];
  const meeting = formatMeeting(club.meetsAt, club.meetsOn, locale);
  const clubCopies = club.book
    ? listingsForBook(club.book.id, viewer?.id ?? null, {
        city: club.city,
        availableOnly: true,
      })
    : [];
  // Solo los miembros ven la votación, el histórico y quién va leyendo.
  const votacion = viewer && club.isMember ? getActiveClubPoll(club.id, viewer.id) : null;
  const historial = viewer && club.isMember ? listClubMeetingHistory(club.id) : [];
  const estados = new Map(
    viewer && club.isMember && club.book
      ? listClubReadingStates(club.id, club.book.id).map((row) => [row.userId, row.status] as const)
      : [],
  );
  // El foro es privado del club: si no eres miembro, no se pide siquiera.
  const forum =
    viewer && club.isMember
      ? listClubPosts(club.id, { id: viewer.id, isAdmin: viewer.isAdmin })
      : null;

  return (
    <SiteShell user={viewer} section="clubes" title={club.name}>
      <PageHeader
        overline={`${t("CLUB DE LECTURA")} · ${club.city.toUpperCase()}`}
        title={club.name}
        description={
          <>
            {club.city} ·{" "}
            {club.description && `${club.description} · `}
            {t("Creado")} {formatWhen(club.createdAt, locale)} · {t("por")} {club.owner.name} ·{" "}
            {club.members === 1 ? t("1 miembro") : t("{n} miembros", { n: club.members })}
            {club.joinPolicy === "approval" && ` · ${t("entrada con aprobación")}`}
          </>
        }
        aside={viewer ? <ClubJoin club={club} /> : undefined}
      />

      <div className="club-tools">
        {club.isMember && (
          <ClubShare
            club={club}
            following={following}
            extra={
              club.isMine ? (
                <>
                  {todos && (
                    <ClubMembersMenu
                      clubId={club.id}
                      members={todos.members
                        .filter((member) => !member.isOwner)
                        .map((member) => ({
                      id: member.id,
                      name: member.name,
                      isModerator: member.isModerator,
                    }))}
                    />
                  )}
                  {/* Editar (con el cierre dentro) vive aquí arriba, junto al
                      resto de lo que solo ve quien dirige el club. */}
                  <ClubSettings club={club} />
                </>
              ) : undefined
            }
          />
        )}
        {/* Denunciar un club es cosa de sus miembros: quien no está dentro no
            tiene por qué tener ese botón delante. */}
        {viewer && club.isMember && !club.isMine && <ClubReport clubId={club.id} />}
      </div>

      {/* Quien pide entrar espera respuesta: eso va arriba y a todo el ancho,
          no en una tercera columna que hay que ir a buscar. */}
      {llevaElClub && requests.length > 0 && (
        <section className="club-panel club-requests-panel">
          <h2>
            {t("Solicitudes de entrada")} · {requests.length}
          </h2>
          <ClubRequests clubId={club.id} requests={requests} />
        </section>
      )}

      {/* La votación es una decisión abierta, no un archivo: va arriba con las
          solicitudes, y así el foro queda justo detrás de las fichas. */}
      {(votacion || club.isMine) && (
        <ClubPoll clubId={club.id} initialPoll={votacion} canManage={club.isMine} />
      )}

      {/* Moderación: solo aparece si hay algo que decidir. */}
      {denuncias.length > 0 && (
        <section className="club-panel club-requests-panel">
          <h2>
            {t("Mensajes denunciados")} · {denuncias.length}
          </h2>
          <ClubReports clubId={club.id} reports={denuncias} />
        </section>
      )}

      <div className="club-detail">
        <section className="club-panel">
          <h2>{t("Lectura en curso")}</h2>
          {club.book ? (
            <Link href={`/obra/${club.book.id}`} className="club-reading is-detail">
              <BookOpen size={16} /> {club.book.title} · {club.book.author}
            </Link>
          ) : (
            <p className="empty-note">{t("Sin lectura elegida todavía.")}</p>
          )}
          {club.book && (
            <div className="club-copies">
              <strong>{t("Ejemplares en la ciudad del club")}</strong>
              {clubCopies.length === 0 ? (
                <p className="empty-note">
                  {t("Todavía no hay ejemplares de esta lectura en la ciudad. Puedes publicar uno o pedir a alguien del club que lo comparta.")}
                </p>
              ) : (
                <ul>
                  {clubCopies.map((listing) => (
                    <li key={listing.id}>
                      <Link href={`/libro/${listing.id}`}>
                        {t(listing.condition)} · {listing.owner.name}
                        {listing.distanceKm !== null && ` · ${listing.distanceKm} km`}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {club.progress > 0 && (
            <div className="club-progress">
              <span className="club-progress-bar" aria-hidden>
                <span style={{ width: `${Math.min(100, Math.max(0, club.progress))}%` }} />
              </span>
              <small>
                {club.progress}%{club.progressNote && ` · ${club.progressNote}`}
              </small>
            </div>
          )}
        </section>

        <section className="club-panel">
          <h2>
            <CalendarClock size={16} /> {t("Encuentro")}
          </h2>
          {meeting && (
            <p className="club-meta">
              <CalendarClock size={14} /> {meeting}
              {/* Dónde se ve el club es información de dentro: fuera solo se
                  anuncia la fecha. */}
              {club.isMember && club.meetsPlace && ` · ${club.meetsPlace}`}
            </p>
          )}
          {club.isMember && club.meetsLink && (
            <p className="club-meta club-meeting-link">
              <Link2 size={14} />{" "}
              <a href={club.meetsLink} target="_blank" rel="noreferrer noopener">
                {t("Enlace del encuentro")}
              </a>
            </p>
          )}
          {!club.isMember && (meeting || club.meetsLink) && (
            <p className="club-meta">
              {t("El sitio y el enlace del encuentro los ven solo quienes están en el club.")}
            </p>
          )}
          {historial.length > 0 && (
            <div className="club-history">
              <strong>{t("Encuentros anteriores")}</strong>
              <ul>
                {historial.map((item) => (
                  <li key={item.key}>
                    {/^\d{4}-\d{2}-\d{2}T/.test(item.key)
                      ? formatMeeting(item.key, "", locale)
                      : item.key}
                    {" · "}
                    {item.attendees === 1
                      ? t("1 persona")
                      : t("{n} personas", { n: item.attendees })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {viewer && <ClubAttendance club={club} />}
          {!meeting && !club.meetsLink && historial.length === 0 && (
            <p className="empty-note">{t("Sin fecha ni lugar todavía.")}</p>
          )}
        </section>

        {/* La ficha de miembros no existe fuera del club: el número ya está en
            la cabecera y una tarjeta explicando lo que no se puede ver sobra. */}
        {members && (
        <section className="club-panel">
          <h2>
            <Users size={16} /> {t("Miembros")}
          </h2>
          <ul className="club-members">
            {members.members.map((member) => (
              <li key={member.id}>
                <Link href={`/u/${member.id}`} className="club-member">
                  <span className={`avatar comment-avatar tone-${toneForId(member.id)}`}>
                    {initialsOf(member.name)}
                  </span>
                  <span>
                    <strong>{member.name}</strong>
                    <small>
                      {member.city}
                      {member.isOwner && ` · ${t("quien lo creó")}`}
                      {!member.isOwner && member.isModerator && ` · ${t("moderador")}`}
                      {estados.get(member.id) === "reading" && ` · ${t("leyendo")}`}
                      {estados.get(member.id) === "read" && ` · ${t("leído")}`}
                    </small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {members.total > members.members.length && (
            <nav className="club-member-pager" aria-label={t("Páginas de miembros")}>
              {membersPage > 1 ? (
                <Link
                  className="secondary-button small"
                  href={`/clubes/${club.id}?membersPage=${membersPage - 1}`}
                >
                  {t("Anterior")}
                </Link>
              ) : (
                <span className="secondary-button small is-disabled">{t("Anterior")}</span>
              )}
              <span>
                {members.members.length} / {members.total}
              </span>
              {members.hasMore ? (
                <Link
                  className="secondary-button small"
                  href={`/clubes/${club.id}?membersPage=${membersPage + 1}`}
                >
                  {t("Siguiente")}
                </Link>
              ) : (
                <span className="secondary-button small is-disabled">{t("Siguiente")}</span>
              )}
            </nav>
          )}
        </section>
        )}

      </div>

      {/* Foro del club: es la razón por la que el grupo se lee, así que va a
          todo el ancho, justo después de las fichas y sin nada entre medias. */}
      {forum ? (
        <section className="club-panel club-forum-panel">
          <ClubForum
            clubId={club.id}
            initialPosts={forum.posts}
            initialHasMore={forum.hasMore}
            total={forum.total}
          />
        </section>
      ) : (
        <section className="club-panel club-forum-panel" id="foro">
          <h2>
            <Lock size={16} /> {t("Foro del club")}
          </h2>
          <p className="empty-note">
            {club.myStatus === "pending"
              ? t("Tu solicitud está pendiente: en cuanto te acepten verás aquí las conversaciones del club.")
              : t("El foro solo lo leen los miembros: aquí se habla de la lectura, de los encuentros y de lo que apetezca leer después, sin mensajes privados.")}
          </p>
        </section>
      )}

    </SiteShell>
  );
}
