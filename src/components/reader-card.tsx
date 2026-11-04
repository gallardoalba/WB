"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, UserCheck, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/client-api";
import type { ReaderView } from "@/lib/domain";
import { formatDistance, formatWhen, initialsOf, toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";

/** Tarjeta de una persona en el directorio, con seguimiento instantáneo. */
export function ReaderCard({
  reader,
  isAuthenticated,
}: {
  reader: ReaderView;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [following, setFollowing] = useState(reader.isFollowing);
  const [followers, setFollowers] = useState(reader.followers);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    const next = !following;
    setPending(true);
    setError("");
    try {
      const data = await api<{ following: boolean; followers: number }>(
        `/api/users/${reader.user.id}/follow`,
        { method: "POST", body: { follow: next } },
      );
      setFollowing(data.following);
      setFollowers(data.followers);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo completar la acción."));
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="reader-card">
      <Link
        href={`/u/${reader.user.id}`}
        className={`avatar reader-avatar tone-${toneForId(reader.user.id)}`}
        aria-label={t("Ver el perfil de {name}", { name: reader.user.name })}
      >
        {initialsOf(reader.user.name)}
      </Link>
      <div className="reader-copy">
        <Link href={`/u/${reader.user.id}`} className="reader-name">
          {reader.user.name}
        </Link>
        <span className="reader-meta">
          {reader.user.city}
          {reader.distanceKm !== null && ` · ${formatDistance(reader.distanceKm, locale)}`} ·{" "}
          {reader.followers === 1
            ? t("1 seguidor")
            : t("{n} seguidores", { n: followers })}
        </span>
        <p className="reader-bio">{reader.user.bio || t("Sin biografía todavía.")}</p>
        <span className="reader-books">
          <BookOpen size={13} />{" "}
          {reader.published === 1
            ? t("1 libro publicado")
            : t("{n} libros publicados", { n: reader.published })}
        </span>
        {reader.sharedBooks > 0 && (
          <span className="reader-books reader-affinity">
            <BookOpen size={13} />{" "}
            {reader.sharedBooks === 1
              ? t("1 obra en común")
              : t("{n} obras en común", { n: reader.sharedBooks })}
          </span>
        )}
        {reader.clubs > 0 && (
          <span className="reader-books">
            <Users size={13} />{" "}
            {reader.clubs === 1 ? t("1 club") : t("{n} clubes", { n: reader.clubs })}
          </span>
        )}
        {reader.lastActiveAt && (
          <span className="reader-last-active">
            {t("Última actividad")}: {formatWhen(reader.lastActiveAt, locale)}
          </span>
        )}
        {error && (
          <span className="form-error" role="alert">
            {error}
          </span>
        )}
      </div>
      {isAuthenticated && !reader.isMe && (
        <button
          type="button"
          className={following ? "secondary-button small following" : "secondary-button small"}
          disabled={pending}
          aria-pressed={following}
          onClick={toggle}
        >
          {following ? <UserCheck size={14} /> : <UserPlus size={14} />}
          {following ? t("Siguiendo") : t("Seguir")}
        </button>
      )}
    </article>
  );
}
