import Link from "next/link";
import type { Metadata } from "next";
import { Library } from "lucide-react";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { requirePageUser } from "@/lib/page-auth";
import { regionName } from "@/lib/cities";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { allowPageView } from "@/lib/page-throttle";
import { listPublicReadingLists } from "@/lib/repo";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Listas de lectura"),
    description: translate(locale, "Listas de lectura compartidas por la comunidad de {region}.", { region: regionName(locale) }),
    alternates: { canonical: "/listas" },
  };
}

const PAGE_SIZE = 12;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: PageProps) {
  const raw = await searchParams;
  const query = (firstValue(raw.q) ?? "").trim().slice(0, 60);
  const page = Math.max(1, Number.parseInt(firstValue(raw.page) ?? "1", 10) || 1);

  const viewer = await requirePageUser("/listas");
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  if (!(await allowPageView(240, 60_000, viewer?.id ?? null))) {
    return (
      <main className="page-shell">
        <h1>{t("Demasiadas peticiones")}</h1>
        <p className="empty-note">{t("Espera un minuto antes de volver a cargar las listas.")}</p>
        <Link href="/" className="secondary-button small">
          {t("Volver al catálogo")}
        </Link>
      </main>
    );
  }

  const { lists, total, hasMore } = listPublicReadingLists({
    viewerId: viewer?.id ?? null,
    q: query,
    page,
    pageSize: PAGE_SIZE,
  });

  const buildHref = (patch: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const next = { q: query, page, ...patch };
    if (next.q) params.set("q", String(next.q));
    if (Number(next.page) > 1) params.set("page", String(next.page));
    const search = params.toString();
    return search ? `/listas?${search}` : "/listas";
  };

  return (
    <SiteShell user={viewer} section="listas" title={t("Listas")}>
      <PageHeader
        overline={t("LO QUE LA COMUNIDAD RECOMIENDA")}
        title={t("Listas de lectura")}
        description={t("Selecciones que otras personas comparten para descubrir la próxima lectura.")}
        aside={
          <span className="shelf-count">
            {total === 1 ? t("1 lista") : t("{n} listas", { n: total })}
          </span>
        }
      />

      <form className="reader-filters" action="/listas" method="get">
        <label className="sr-only" htmlFor="list-q">
          {t("Buscar lista")}
        </label>
        <input
          id="list-q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder={t("Buscar por título o descripción")}
          maxLength={60}
        />
        <button type="submit" className="secondary-button small">
          {t("Filtrar")}
        </button>
      </form>

      {lists.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Library size={22} />
          </span>
          <h3>{query ? t("Ninguna lista con esa búsqueda") : t("Todavía no hay listas públicas")}</h3>
          <p>
            {t(
              "Las listas se crean desde la ficha de una obra o desde tu perfil y quedan visibles para toda la comunidad.",
            )}
          </p>
          <Link href="/?view=discover" className="secondary-button small">
            {t("Explorar el catálogo")}
          </Link>
        </div>
      ) : (
        <ul className="community-lists list-index">
          {lists.map((list) => (
            <li key={list.id}>
              <Link href={`/listas/${list.id}`} className="community-list-card">
                <strong>{list.title}</strong>
                <span>
                  {list.owner.name} · {list.items === 1 ? t("1 obra") : t("{n} obras", { n: list.items })}
                </span>
                {list.description && <p>{list.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || hasMore) && (
        <nav className="pager" aria-label={t("Paginación de listas")}>
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
