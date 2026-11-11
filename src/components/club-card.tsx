"use client";

import Link from "next/link";
import { BookOpen, CalendarClock, UserRound } from "lucide-react";
import type { ClubView } from "@/lib/domain";
import { formatMeeting, initialsOf, toneForId } from "@/lib/text";
import { ClubJoin } from "./club-board";
import { useI18n } from "./i18n-provider";

/** Tarjeta de club compartida por el directorio y el panel de comunidad. */
export function ClubCard({ club, compact = false }: { club: ClubView; compact?: boolean }) {
  const { t, locale } = useI18n();
  const meeting = formatMeeting(club.meetsAt, club.meetsOn, locale);
  return (
    <article className={compact ? "club-card compact" : "club-card"}>
      <div className="club-head">
        <h2>
          <Link href={`/clubes/${club.id}`}>{club.name}</Link>
        </h2>
        <span className="club-city">{club.city}</span>
      </div>

      <div className="club-signals">
        <span className="club-avatars" aria-hidden>
          {club.memberPreview.map((member) => (
            <span
              key={`${club.id}-${member.id}-${member.name}`}
              className={`avatar club-avatar tone-${toneForId(member.name)}`}
            >
              {initialsOf(member.name)}
            </span>
          ))}
        </span>
        <span className="club-meta">
          <UserRound size={13} />{" "}
          {club.members === 1 ? t("1 miembro") : t("{n} miembros", { n: club.members })}
        </span>
        <span className="club-meta club-owner-name">
          {t("por {name}", { name: club.owner.name })}
        </span>
      </div>

      {club.book && (
        <Link href={`/obra/${club.book.id}`} className="club-reading">
          <BookOpen size={14} /> {club.book.title} · {club.book.author}
        </Link>
      )}

      {club.description && <p className="club-desc">{club.description}</p>}

      {meeting && (
        <span className="club-meta club-meeting">
          <CalendarClock size={13} /> {meeting}
          {club.attendees > 0 && ` · ${t("{n} confirmados", { n: club.attendees })}`}
        </span>
      )}

      {club.progress > 0 && (
        <div className="club-progress">
          <span className="club-progress-bar" aria-hidden>
            <span style={{ width: `${Math.min(100, Math.max(0, club.progress))}%` }} />
          </span>
          <small>
            {club.progress}% {club.progressNote && `· ${club.progressNote}`}
          </small>
        </div>
      )}

      <div className="club-foot">
        <ClubJoin club={club} />
        {club.isMine && club.pendingRequests > 0 && (
          <span className="club-pending">
            {club.pendingRequests === 1
              ? t("1 solicitud por revisar")
              : t("{n} solicitudes por revisar", { n: club.pendingRequests })}
          </span>
        )}
      </div>
    </article>
  );
}
