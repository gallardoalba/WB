import Link from "next/link";
import type { Metadata } from "next";
import { Users } from "lucide-react";
import { ReaderCard } from "@/components/reader-card";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { requirePageUser } from "@/lib/page-auth";
import { CITIES, regionName } from "@/lib/cities";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { allowPageView } from "@/lib/page-throttle";
import { listReaders } from "@/lib/repo";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Lectores"),
    description: translate(locale, "Lectores activos que comparten libros en {region}, por ciudad.", { region: regionName(locale) }),
    alternates: { canonical: "/lectores" },
  };
}

const PAGE_SIZE = 12;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: PageProps) {
  const raw = await searchParams;
  const query = (firstValue(raw.q) ?? "").trim().slice(0, 60);
  const rawCity = firstValue(raw.city) ?? "";
  const city = CITIES.some((entry) => entry.name === rawCity) ? rawCity : "";
  const rawSort = firstValue(raw.sort) ?? "";
  const sort = (["followers", "near", "active"] as const).find((value) => value === rawSort);
  const page = Math.max(1, Number.parseInt(firstValue(raw.page) ?? "1", 10) || 1);

  const viewer = await requirePageUser("/lectores");
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  // El directorio publica nombre, ciudad y biografía: se limita el raspado.
  const allowed = await allowPageView(240, 60_000);
  if (!allowed) {
    return (
      <main className="page-shell">
        <h1>{t("Demasiadas peticiones")}</h1>
        <p className="empty-note">
          {t("Has abierto el directorio muchas veces en poco tiempo. Espera un minuto y vuelve a intentarlo.")}
        </p>
        <Link href="/" className="secondary-button small">
          {t("Volver al catálogo")}
        </Link>
      </main>
    );
  }

  const { readers, total, hasMore } = listReaders({
    viewerId: viewer?.id ?? null,
    city: city || null,
    q: query,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  const buildHref = (patch: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const next = { q: query, city, sort, page, ...patch };
    if (next.q) params.set("q", String(next.q));
    if (next.city) params.set("city", String(next.city));
    if (next.sort) params.set("sort", String(next.sort));
    if (Number(next.page) > 1) params.set("page", String(next.page));
    const search = params.toString();
    return search ? `/lectores?${search}` : "/lectores";
  };

  return (
    <SiteShell user={viewer} section="lectores" title={t("Lectores")}>
      <PageHeader
        overline={t("DIRECTORIO DE LA REGIÓN")}
        title={`${t("Lectores de")} ${regionName(locale)}`}
        description={t("Personas activas con las que compartir lecturas, ordenadas por cercanía, afinidad o actividad.")}
        aside={<span className="shelf-count">{t("{n} personas", { n: total })}</span>}
      />

      <form className="reader-filters" action="/lectores" method="get">
        <label className="sr-only" htmlFor="reader-q">
          {t("Buscar lector")}
        </label>
        <input
          id="reader-q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder={t("Buscar por nombre")}
          maxLength={60}
        />
        <label className="sr-only" htmlFor="reader-city">
          {t("Ciudad")}
        </label>
        <select id="reader-city" name="city" defaultValue={city}>
          <option value="">{t("Toda la región")}</option>
          {CITIES.map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.name}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="reader-sort">
          {t("Orden")}
        </label>
        <select id="reader-sort" name="sort" defaultValue={sort ?? "followers"}>
          <option value="followers">{t("Con más seguidores")}</option>
          <option value="near">{t("Más cercanos")}</option>
          <option value="active">{t("Actividad reciente")}</option>
        </select>
        <button type="submit" className="secondary-button small">
          {t("Filtrar")}
        </button>
      </form>

      {readers.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Users size={22} />
          </span>
          <h3>{t("Nadie con esos filtros")}</h3>
          <p>{t("Prueba con otra ciudad o sin búsqueda.")}</p>
        </div>
      ) : (
        <div className="reader-list">
          {readers.map((reader) => (
            <ReaderCard
              key={reader.user.id}
              reader={reader}
              isAuthenticated={Boolean(viewer) && viewer?.id !== reader.user.id}
            />
          ))}
        </div>
      )}

      {(page > 1 || hasMore) && (
        <nav className="pager" aria-label={t("Paginación del directorio")}>
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
