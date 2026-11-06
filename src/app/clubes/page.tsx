import Link from "next/link";
import type { Metadata } from "next";
import { Users } from "lucide-react";
import { ClubCreate } from "@/components/club-board";
import { ClubCard } from "@/components/club-card";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { requirePageUser } from "@/lib/page-auth";
import { regionName } from "@/lib/cities";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { allowPageView } from "@/lib/page-throttle";
import { getBook, listClubs } from "@/lib/repo";
import { citiesInUse } from "@/lib/repo/shared";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Clubes de lectura"),
    description: translate(locale, "Clubs de lectura por ciudad en {region}: lectura en curso y encuentros.", { region: regionName(locale) }),
    alternates: { canonical: "/clubes" },
  };
}

const PAGE_SIZE = 12;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: PageProps) {
  const raw = await searchParams;
  const rawCity = firstValue(raw.city) ?? "";
  const city = rawCity.trim().slice(0, 80);
  const q = (firstValue(raw.q) ?? "").trim().slice(0, 60);
  const rawSort = firstValue(raw.sort) ?? "";
  const sort = (["members", "meeting", "recent", "near"] as const).find(
    (value) => value === rawSort,
  );
  const mine = firstValue(raw.mine) === "1";
  const page = Math.max(1, Number.parseInt(firstValue(raw.page) ?? "1", 10) || 1);
  const rawBook = firstValue(raw.book) ?? "";
  const book = rawBook ? getBook(rawBook) : null;

  const viewer = await requirePageUser("/clubes");
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  if (!(await allowPageView(240, 60_000, viewer?.id ?? null))) {
    return (
      <main className="page-shell">
        <h1>{t("Demasiadas peticiones")}</h1>
        <p className="empty-note">{t("Espera un minuto antes de volver a cargar los clubs.")}</p>
        <Link href="/" className="secondary-button small">
          {t("Volver al catálogo")}
        </Link>
      </main>
    );
  }

  const { clubs, total, hasMore } = listClubs({
    viewerId: viewer?.id ?? null,
    city: city || null,
    q,
    mine,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  const buildHref = (patch: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const next = { q, city, sort, mine: mine ? "1" : "", page, ...patch };
    if (next.q) params.set("q", String(next.q));
    if (next.city) params.set("city", String(next.city));
    if (next.sort) params.set("sort", String(next.sort));
    if (next.mine) params.set("mine", "1");
    if (Number(next.page) > 1) params.set("page", String(next.page));
    const search = params.toString();
    return search ? `/clubes?${search}` : "/clubes";
  };

  return (
    <SiteShell user={viewer} section="clubes" title={t("Clubes")}>
      <PageHeader
        overline={t("LEER EN COMPAÑÍA")}
        title={t("Clubes de lectura")}
        description={t("Clubes por ciudad con lectura en curso, encuentros y la conversación en el hilo del libro.")}
        aside={
          <>
            <span className="shelf-count">
              {total === 1 ? t("1 club") : t("{n} clubes", { n: total })}
            </span>
            {viewer && <ClubCreate defaultCity={viewer.city} book={book} />}
          </>
        }
      />

      <div className="clubs-toolbar">
        <form className="club-filters" action="/clubes" method="get">
          <label className="sr-only" htmlFor="club-q">
            {t("Buscar club")}
          </label>
          <input
            id="club-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={t("Buscar club")}
            maxLength={60}
          />
          <label className="sr-only" htmlFor="club-city">
            {t("Ciudad")}
          </label>
          <select id="club-city" name="city" defaultValue={city}>
            <option value="">{t("Toda Europa")}</option>
            {citiesInUse("clubs").map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="club-sort">
            {t("Orden")}
          </label>
          <select id="club-sort" name="sort" defaultValue={sort ?? "members"}>
            <option value="members">{t("Con más miembros")}</option>
            <option value="meeting">{t("Próximo encuentro")}</option>
            <option value="near">{t("Más cercanos")}</option>
            <option value="recent">{t("Más recientes")}</option>
          </select>
          {viewer && (
            <label className="checkbox-row club-mine">
              <input type="checkbox" name="mine" value="1" defaultChecked={mine} />
              {t("Solo mis clubes")}
            </label>
          )}
          <button type="submit" className="secondary-button small">
            {t("Filtrar")}
          </button>
        </form>
      </div>

      {book && (
        <p className="club-book-banner">
          {t("Creando un club con")} <strong>{book.title}</strong>
          {t(": la conversación ocurrirá en el")}{" "}
          <Link href={`/obra/${book.id}`} className="inline-link">
            {t("hilo del libro")}
          </Link>
          .
        </p>
      )}

      {clubs.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Users size={22} />
          </span>
            <h3>{q || mine ? t("Ningún club con esos filtros") : t("Todavía no hay clubs")}</h3>
          <p>
            {q || mine
              ? t("Prueba con otra ciudad, otro nombre o quita el filtro de tus clubes.")
              : t("Crea el primero de tu ciudad y propón una lectura.")}
          </p>
        </div>
      ) : (
        <div className="club-list">
          {clubs.map((club) => (
            <ClubCard key={club.id} club={club} />
          ))}
        </div>
      )}

      {(page > 1 || hasMore) && (
        <nav className="pager" aria-label={t("Paginación de clubs")}>
          {page <= 1 ? (
            <span className="secondary-button small is-disabled" aria-disabled="true">
              {t("Anterior")}
            </span>
          ) : (
            <Link className="secondary-button small" href={buildHref({ page: page - 1 })}>
              {t("Anterior")}
            </Link>
          )}
          <span>
            {t("Página")} {page}
          </span>
          {hasMore ? (
            <Link className="secondary-button small" href={buildHref({ page: page + 1 })}>
              {t("Siguiente")}
            </Link>
          ) : (
            <span className="secondary-button small is-disabled" aria-disabled="true">
              {t("Siguiente")}
            </span>
          )}
        </nav>
      )}
    </SiteShell>
  );
}
