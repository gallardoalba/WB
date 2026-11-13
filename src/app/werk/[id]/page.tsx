import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BookOpen, MapPin } from "lucide-react";
import { BookCover } from "@/components/book-cover";
import { SiteShell } from "@/components/site-shell";
import { getSessionUser } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { localePath, type Locale } from "@/lib/locale";
import { alternatesFor } from "@/lib/seo";
import { socialMetadata } from "@/lib/social";
import { getPublicWork, type PublicWork } from "@/lib/repo";
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
 * Resumen de la obra para la descripción y los datos estructurados.
 *
 * En castellano y en alemán el singular no se forma cambiando la terminación
 * («1 ejemplares»), así que el único ejemplar tiene su propia frase. Lo usan
 * tanto el `metadata` como el JSON-LD: el buscador debe leer lo mismo que la
 * vista previa.
 */
function workSummary(
  work: Pick<PublicWork, "title" | "author" | "copies" | "cities">,
  locale: Locale,
): string {
  const cities = work.cities.map((city) => city.city).join(", ");
  if (work.copies === 0) {
    return translate(locale, "«{title}» de {author}: ahora mismo no hay ejemplares disponibles.", {
      title: work.title,
      author: work.author,
    });
  }
  if (work.copies === 1) {
    return translate(locale, "«{title}» de {author}: 1 ejemplar para intercambiar en {cities}.", {
      title: work.title,
      author: work.author,
      cities,
    });
  }
  return translate(locale, "«{title}» de {author}: {n} ejemplares para intercambiar en {cities}.", {
    title: work.title,
    author: work.author,
    n: work.copies,
    cities,
  });
}

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
  const description = workSummary(work, locale);
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
      // La tarjeta de la obra y no la portada suelta: la portada es vertical
      // (231×400 la de este ejemplar) y la vista previa se dibuja apaisada, así
      // que se recortaba y perdía la marca al compartir el enlace en cualquier
      // sitio. La ruta se cachea una hora, así que el coste es el primero.
      image: `/api/og/werk/${work.id}`,
      type: "book",
    }),
  };
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  // El idioma va primero: la redirección de ediciones tiene que conservar el
  // prefijo (`/en/werk/…`), o quien lee en inglés acaba en la versión alemana.
  const locale = await getLocale();
  const work = getPublicWork(id);
  if (!work) notFound();
  // Cada obra tiene una sola URL pública: las demás ediciones redirigen.
  if (work.id !== id) permanentRedirect(localePath(locale, `/werk/${work.id}`));

  const viewer = await getSessionUser();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  const base = siteUrl();
  const language = LANGUAGE_ISO[work.language];
  // La ficha pública enlaza a la ficha completa (`/obra`), que es donde están
  // los ejemplares y el botón de pedir. Sin sesión, `/obra` redirige al acceso
  // y vuelve a esa misma página.
  const workPath = localePath(locale, `/werk/${work.id}`);
  const requestPath = localePath(locale, `/obra/${work.id}`);
  const summary = workSummary(work, locale);

  return (
    <SiteShell user={viewer} section="obra" title={work.title} rail={Boolean(viewer)}>
      <nav className="public-breadcrumb" aria-label={t("Ruta de navegación")}>
        <Link href={localePath(locale, "/descubrir")}>{t("Descubrir todos los libros")}</Link>
        <span className="public-breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <span aria-current="page">{work.title}</span>
      </nav>

      <article className="book-detail public-work">
        {/* El orden del HTML es el de lectura en móvil: título, disponibilidad y
            acción primero; la portada después. En escritorio, las áreas de la
            rejilla devuelven la portada a la columna izquierda. */}
        <div className="book-detail-info public-work-head">
          <h1>{work.title}</h1>
          <p className="book-detail-author">{work.author}</p>

          {work.copies > 0 ? (
            <p className="public-work-availability">
              <MapPin size={14} aria-hidden="true" />
              <strong>
                {work.copies === 1 ? t("1 ejemplar") : t("{n} ejemplares", { n: work.copies })}
              </strong>
              <span aria-hidden="true">·</span>
              {/* Con más de un ejemplar interesa saber cuántos hay en cada
                  ciudad; con uno solo, el número sería ruido. */}
              <span>
                {work.cities
                  .map((city) => (work.copies > 1 ? `${city.city} (${city.copies})` : city.city))
                  .join(" · ")}
              </span>
            </p>
          ) : (
            <p className="public-work-availability is-empty">
              {t(
                "Este libro todavía no tiene ejemplares disponibles. Si tienes uno, puedes ofrecerlo.",
              )}
            </p>
          )}

          <div className="public-work-actions">
            {work.copies > 0 ? (
              viewer ? (
                <Link href={requestPath} className="share-button public-work-primary">
                  <BookOpen size={16} aria-hidden="true" /> {t("Pedir este libro")}
                </Link>
              ) : (
                <Link
                  href={`/?auth=1&next=${encodeURIComponent(requestPath)}`}
                  className="share-button public-work-primary"
                >
                  <BookOpen size={16} aria-hidden="true" /> {t("Entrar para pedirlo")}
                </Link>
              )
            ) : (
              <Link
                href={localePath(locale, "/ofrecer")}
                className="share-button public-work-primary"
              >
                <BookOpen size={16} aria-hidden="true" /> {t("Ofrecer un libro")}
              </Link>
            )}

            <Link
              href={localePath(locale, "/descubrir")}
              className="secondary-button public-work-secondary"
            >
              {t("Ver en el catálogo")}
            </Link>
          </div>
        </div>

        <div className={`book-detail-cover tone-${toneForId(work.id)}`}>
          <BookCover
            id={work.id}
            title={work.title}
            coverUrl={work.coverUrl}
            sizes="(max-width: 768px) 80vw, 260px"
            priority
          />
        </div>

        <div className="public-work-body">
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
            {work.pages && (
              <div>
                <dt>{t("Páginas")}</dt>
                <dd>{work.pages}</dd>
              </div>
            )}
          </dl>

          {/* Sinopsis: el párrafo que el catálogo dio al publicar. Es texto
              libre de terceros, así que se pinta tal cual (React lo escapa). */}
          {work.description && (
            <section className="public-work-synopsis">
              <h2>{t("Sinopsis")}</h2>
              <p>{work.description}</p>
            </section>
          )}
        </div>
      </article>

      {work.copies > 0 && (
        <section className="public-work-context">
          <p>
            {t(
              "Los ejemplares están en manos de quienes los ofrecen: se quedan ahí hasta que alguien los pide, y la entrega se acuerda entre las dos personas. La plataforma solo mantiene el índice.",
            )}
          </p>
        </section>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Book",
            name: work.title,
            author: { "@type": "Person", name: work.author },
            description: summary,
            url: `${base}${workPath}`,
            ...(work.isbn ? { isbn: work.isbn } : {}),
            ...(language ? { inLanguage: language } : {}),
            ...(work.publisher
              ? { publisher: { "@type": "Organization", name: work.publisher } }
              : {}),
            ...(work.year && /^\d{4}$/.test(work.year) ? { datePublished: work.year } : {}),
            offers: {
              "@type": "Offer",
              url: `${base}${workPath}`,
              // Los ejemplares son de segunda mano: Google no debe anunciarlo
              // como un libro nuevo, y el vendedor es la propia comunidad.
              price: "0",
              priceCurrency: "EUR",
              itemCondition: "https://schema.org/UsedCondition",
              availability:
                work.copies > 0
                  ? "https://schema.org/InStock"
                  : "https://schema.org/OutOfStock",
              seller: { "@type": "Organization", name: "Wanderbibliothek", url: base },
              areaServed: work.cities.map((city) => ({ "@type": "City", name: city.city })),
            },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </SiteShell>
  );
}
