import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";
import { BookOpen, CalendarClock, Users } from "lucide-react";
import {
  ClubAttendance,
  ClubJoin,
  ClubMemberAdmin,
  ClubReport,
  ClubRequests,
  ClubSettings,
  ClubShare,
} from "@/components/club-board";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { ClubLoans } from "@/components/club-loans";
import { requirePageUser } from "@/lib/page-auth";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import {
  getClub,
  listClubLoans,
  listClubMembers,
  listClubRequests,
  listFollowEdges,
  listOwnerBooks,
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
  if (!club) return { title: locale === "de" ? "Lesekreis nicht gefunden" : "Club no encontrado" };
  return {
    title: club.name,
    description:
      locale === "de"
        ? `Lesekreis in ${club.city}${club.book ? `, liest «${club.book.title}»` : ""}.`
        : `Club de lectura en ${club.city}${club.book ? `, leyendo «${club.book.title}»` : ""}.`,
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

  const members = listClubMembers(club.id, { page: membersPage, pageSize: 24 });
  const books = club.isMine && viewer ? listOwnerBooks(viewer.id) : [];
  const requests = club.isMine && viewer ? listClubRequests(club.id, viewer.id) : [];
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
  // Los préstamos solo los ven los miembros del club (ver `listClubLoans`).
  const clubLoans = viewer && club.isMember ? listClubLoans(club.id, viewer.id) : [];

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
        {club.isMember && <ClubShare club={club} following={following} />}
        {viewer && !club.isMine && <ClubReport clubId={club.id} />}
      </div>

      <div className="club-detail">
        <section className="club-panel">
          <h2>{t("Lectura en curso")}</h2>
          {club.book ? (
            <Link href={`/obra/${club.book.id}`} className="club-reading">
              <BookOpen size={15} /> {club.book.title} · {club.book.author}
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
          {meeting && (
            <p className="club-meta">
              <CalendarClock size={14} /> {meeting}
              {club.attendees > 0 &&
                ` · ${t("{n} confirmados", { n: club.attendees })}`}
            </p>
          )}
          {viewer && <ClubAttendance club={club} />}
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
          <p className="detail-footer">
            {t("La conversación del club es la del libro: entra en su hilo para comentar con el resto.")}
          </p>
          {viewer && club.isMember && (
            <ClubLoans
              clubId={club.id}
              loans={clubLoans}
              copies={clubCopies}
              members={members.members.map((member) => ({ id: member.id, name: member.name }))}
              viewerId={viewer.id}
            />
          )}
        </section>

        <section className="club-panel">
          <h2>
            <Users size={16} /> Miembros
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
                    </small>
                  </span>
                </Link>
                {club.isMine && !member.isOwner && (
                  <ClubMemberAdmin clubId={club.id} userId={member.id} name={member.name} />
                )}
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

        {club.isMine && (
          <section className="club-panel">
            <h2>{t("Solicitudes de entrada")}</h2>
            <ClubRequests clubId={club.id} requests={requests} />
          </section>
        )}
      </div>

      {club.isMine && viewer && <ClubSettings club={club} books={books} />}
    </SiteShell>
  );
}
