import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, Library, Search, Users } from "lucide-react";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { requirePageUser } from "@/lib/page-auth";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { allowPageView } from "@/lib/page-throttle";
import { listClubs, listPublicReadingLists, listReaders, searchBooks } from "@/lib/repo";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const instant = false;

/** Cuántas coincidencias se enseñan por sección antes de mandar a la completa. */
const PER_SECTION = 6;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Buscar"),
    // Una página de resultados no aporta nada al índice y multiplica URLs.
    robots: { index: false, follow: true },
  };
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resultados de la búsqueda global.
 *
 * Se busca a la vez en obras, clubes, lectores y listas — cada sección tiene su
 * propia consulta y su propio filtro, así que aquí solo se juntan los primeros
 * resultados y se enlaza a la sección completa para seguir afinando.
 */
export default async function Page({ searchParams }: PageProps) {
  // La sesión se comprueba antes de tocar los parámetros: así el redirect sale
  // antes de que Next empiece a emitir la página.
  const viewer = await requirePageUser("/buscar");
  const raw = await searchParams;
  const q = (firstValue(raw.q) ?? "").trim().slice(0, 60);
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);

  if (!(await allowPageView(240, 60_000, viewer?.id ?? null))) {
    return (
      <main className="page-shell">
        <h1>{t("Demasiadas peticiones")}</h1>
        <p className="empty-note">{t("Espera un minuto antes de volver a buscar.")}</p>
        <Link href="/" className="secondary-button small">
          {t("Volver al catálogo")}
        </Link>
      </main>
    );
  }

  const viewerId = viewer?.id ?? null;
  const books = q ? searchBooks(q, PER_SECTION) : [];
  const clubs = q
    ? listClubs({ viewerId, q, pageSize: PER_SECTION })
    : { clubs: [], total: 0, hasMore: false };
  const readers = q
    ? listReaders({ viewerId, q, pageSize: PER_SECTION })
    : { readers: [], total: 0, hasMore: false };
  const lists = q
    ? listPublicReadingLists({ viewerId, q, pageSize: PER_SECTION })
    : { lists: [], total: 0, hasMore: false };

  const total =
    books.length + clubs.total + readers.total + lists.total;
  const encoded = encodeURIComponent(q);

  return (
    <SiteShell user={viewer} section="clubes" title={t("Buscar")}>
      <PageHeader
        overline={t("BUSCAR EN LA COMUNIDAD")}
        title={q ? t("Resultados para «{q}»", { q }) : t("Buscar")}
        description={
          q
            ? total === 1
              ? t("1 coincidencia entre obras, clubes, lectores y listas.")
              : t("{n} coincidencias entre obras, clubes, lectores y listas.", { n: total })
            : t("Obras, clubes de lectura, lectores y listas públicas, en un solo sitio.")
        }
        aside={
          <form className="search-inline" action="/buscar" method="get">
            <label className="sr-only" htmlFor="search-q">
              {t("Buscar en la comunidad")}
            </label>
            <input
              id="search-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder={t("Buscar libros, clubes, lectores…")}
              maxLength={60}
            />
            <button type="submit" className="secondary-button small">
              <Search size={14} /> {t("Buscar")}
            </button>
          </form>
        }
      />

      {!q ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Search size={22} />
          </span>
          <h2>{t("Escribe algo para empezar")}</h2>
          <p>
            {t(
              "Prueba con un título, un autor, el nombre de un club o de una persona. El buscador está siempre en la cabecera.",
            )}
          </p>
        </div>
      ) : total === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Search size={22} />
          </span>
          <h2>{t("Nada con «{q}»", { q })}</h2>
          <p>
            {t("Revisa la ortografía o prueba con menos palabras: busca por título, autoría o ciudad.")}
          </p>
        </div>
      ) : (
        <div className="search-results">
          {books.length > 0 && (
            <section className="search-group">
              <h2>
                <BookOpen size={16} /> {t("Obras")}
              </h2>
              <ul>
                {books.map((book) => (
                  <li key={book.id}>
                    <Link href={`/obra/${book.id}`}>
                      <strong>{book.title}</strong>
                      <span>{book.author}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link className="search-more" href={`/descubrir?q=${encoded}`}>
                {t("Buscar en el catálogo")}
              </Link>
            </section>
          )}

          {clubs.total > 0 && (
            <section className="search-group">
              <h2>
                <Users size={16} /> {t("Clubes")}
              </h2>
              <ul>
                {clubs.clubs.map((club) => (
                  <li key={club.id}>
                    <Link href={`/clubes/${club.id}`}>
                      <strong>{club.name}</strong>
                      <span>
                        {club.city} · {club.members === 1 ? t("1 miembro") : t("{n} miembros", { n: club.members })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link className="search-more" href={`/clubes?q=${encoded}`}>
                {t("Ver todos los clubes")}
              </Link>
            </section>
          )}

          {readers.total > 0 && (
            <section className="search-group">
              <h2>
                <Users size={16} /> {t("Lectores")}
              </h2>
              <ul>
                {readers.readers.map((reader) => (
                  <li key={reader.user.id}>
                    <Link href={`/u/${reader.user.id}`}>
                      <strong>{reader.user.name}</strong>
                      <span>{reader.user.city}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link className="search-more" href={`/lectores?q=${encoded}`}>
                {t("Ver todos los lectores")}
              </Link>
            </section>
          )}

          {lists.total > 0 && (
            <section className="search-group">
              <h2>
                <Library size={16} /> {t("Listas")}
              </h2>
              <ul>
                {lists.lists.map((list) => (
                  <li key={list.id}>
                    <Link href={`/listas/${list.id}`}>
                      <strong>{list.title}</strong>
                      <span>
                        {list.owner.name} ·{" "}
                        {list.items === 1 ? t("1 obra") : t("{n} obras", { n: list.items })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link className="search-more" href={`/listas?q=${encoded}`}>
                {t("Ver todas las listas")}
              </Link>
            </section>
          )}
        </div>
      )}
    </SiteShell>
  );
}
