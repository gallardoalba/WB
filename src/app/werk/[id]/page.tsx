import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BookOpen, MapPin } from "lucide-react";
import { BookCover } from "@/components/book-cover";
import { SiteShell } from "@/components/site-shell";
import { getSessionUser } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { alternatesFor } from "@/lib/seo";
import { socialMetadata } from "@/lib/social";
import { getPublicWork } from "@/lib/repo";
import { siteUrl } from "@/lib/site";
import { toneForId } from "@/lib/text";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

/** Idioma del ejemplar → código ISO, solo para los datos estructurados. */
const LANGUAGE_ISO: Record<string, string> = {
  Español: "es",
  Alemán: "de",
  Inglés: "en",
};

/**
 * Ficha pública de una obra.
 *
 * Es la página del catálogo pensada para buscadores: título, autoría, cifras y
 * ciudades, nunca quién tiene el ejemplar. Todas las ediciones de una obra
 * comparten esta URL: la que no es canónica redirige a la más antigua.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const locale = await getLocale();
  const work = getPublicWork(id);
  if (!work) {
    return {
      title: translate(locale, "Este libro no está en el catálogo"),
      robots: { index: false, follow: false },
    };
  }
  const cities = work.cities.map((city) => city.city).join(", ");
  const description =
    work.copies > 0
      ? translate(
          locale,
          "«{title}» de {author}: {n} ejemplares para intercambiar en {cities}.",
          { title: work.title, author: work.author, n: work.copies, cities },
        )
      : translate(locale, "«{title}» de {author}: ahora mismo no hay ejemplares disponibles.", {
          title: work.title,
          author: work.author,
        });
  return {
    title: `${work.title} — ${work.author}`,
    description,
    alternates: alternatesFor(locale, `/werk/${work.id}`),
    // Sin ejemplares la página no aporta nada nuevo: se deja rastrear el enlace
    // pero no se indexa una ficha vacía.
    robots: work.copies > 0 ? { index: true, follow: true } : { index: false, follow: true },
    ...socialMetadata({
      locale,
      path: `/werk/${work.id}`,
      title: `${work.title} — ${work.author}`,
      description,
      image: work.coverUrl,
      type: "book",
    }),
  };
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const work = getPublicWork(id);
  if (!work) notFound();
  // Cada obra tiene una sola URL pública: las demás ediciones redirigen.
  if (work.id !== id) permanentRedirect(`/werk/${work.id}`);

  const viewer = await getSessionUser();
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  const base = siteUrl();
  const language = LANGUAGE_ISO[work.language];

  return (
    <SiteShell user={viewer} section="obra" title={work.title}>
      <nav className="public-breadcrumb" aria-label={t("Ruta de navegación")}>
        <Link href="/descubrir">{t("Descubrir todos los libros")}</Link>
      </nav>

      <article className="book-detail">
        <div className={`book-detail-cover tone-${toneForId(work.id)}`}>
          <BookCover
            id={work.id}
            title={work.title}
            author={work.author}
            coverUrl={work.coverUrl}
            sizes="(max-width: 700px) 70vw, 280px"
          />
        </div>

        <div className="book-detail-info">
          <h1>{work.title}</h1>
          <p className="book-detail-author">{work.author}</p>

          <dl className="detail-facts">
            <div>
              <dt>{t("Género")}</dt>
              <dd>{t(work.category)}</dd>
            </div>
            <div>
              <dt>{t("Idioma del libro")}</dt>
              <dd>{t(work.language)}</dd>
            </div>
            {work.isbn && (
              <div>
                <dt>ISBN</dt>
                <dd>{work.isbn}</dd>
              </div>
            )}
            {work.publisher && (
              <div>
                <dt>{t("Editorial")}</dt>
                <dd>{work.publisher}</dd>
              </div>
            )}
            {work.year && (
              <div>
                <dt>{t("Año de edición")}</dt>
                <dd>{work.year}</dd>
              </div>
            )}
            {work.series && (
              <div>
                <dt>{t("Colección")}</dt>
                <dd>{work.series}</dd>
              </div>
            )}
            <div>
              <dt>{t("Ejemplares")}</dt>
              <dd>
                {work.copies === 1
                  ? t("1 ejemplar disponible")
                  : t("{n} ejemplares disponibles", { n: work.copies })}
              </dd>
            </div>
          </dl>

          {work.cities.length > 0 ? (
            <section className="public-work-cities">
              <h2>{t("Ciudades con ejemplares")}</h2>
              <ul>
                {work.cities.map((city) => (
                  <li key={city.city}>
                    <MapPin size={13} /> {city.city}
                    {city.copies > 1 && <span> · {city.copies}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="empty-note">
              {t("Este libro todavía no tiene ejemplares disponibles. Si tienes uno, puedes ofrecerlo.")}
            </p>
          )}

          <div className="dialog-actions public-work-actions">
            {viewer ? (
              <Link href="/descubrir" className="share-button">
                <BookOpen size={15} /> {t("Ver en el catálogo")}
              </Link>
            ) : (
              <Link href="/" className="share-button">
                <BookOpen size={15} /> {t("Entrar para pedirlo")}
              </Link>
            )}
          </div>

          <p className="detail-footer">
            {t(
              "Wanderbibliothek no aloja archivos: los intercambios son de ejemplares físicos entre lectores.",
            )}
          </p>
        </div>
      </article>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Book",
            name: work.title,
            author: { "@type": "Person", name: work.author },
            url: `${base}/werk/${work.id}`,
            ...(work.isbn ? { isbn: work.isbn } : {}),
            ...(language ? { inLanguage: language } : {}),
            ...(work.publisher
              ? { publisher: { "@type": "Organization", name: work.publisher } }
              : {}),
            ...(work.year && /^\d{4}$/.test(work.year) ? { datePublished: work.year } : {}),
            offers: {
              "@type": "Offer",
              price: 0,
              priceCurrency: "EUR",
              availability:
                work.copies > 0
                  ? "https://schema.org/InStock"
                  : "https://schema.org/OutOfStock",
              areaServed: work.cities.map((city) => ({ "@type": "City", name: city.city })),
            },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </SiteShell>
  );
}
