import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MapPin, MessageCircle } from "lucide-react";
import { BookCover } from "@/components/book-cover";
import { ListingActions } from "@/components/listing-actions";
import { SiteShell } from "@/components/site-shell";
import { requirePageUser } from "@/lib/page-auth";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { regionName } from "@/lib/cities";
import { pick } from "@/lib/locale";
import { getListing, countBookComments } from "@/lib/repo";
import { formatDistance, formatWhen, initialsOf, toneForId } from "@/lib/text";

type PageProps = { params: Promise<{ id: string }> };

export const instant = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const locale = await getLocale();
  const listing = getListing(id, null);
  if (!listing) {
    // Igual que en los perfiles: la respuesta se emite antes de saber que el
    // ejemplar no existe, así que se resuelve con `noindex` en los metadatos.
    return {
      title: pick(locale, {
        es: "Libro no disponible",
        de: "Buch nicht verfügbar",
        en: "Book not available",
      }),
      robots: { index: false, follow: false },
    };
  }
  return {
    title: `${listing.title} — ${listing.author}`,
    description: pick(locale, {
      es: `Comparte «${listing.title}» de ${listing.author} con ${listing.owner.name} en ${listing.city}.`,
      de: `Teile «${listing.title}» von ${listing.author} mit ${listing.owner.name} in ${listing.city}.`,
      en: `Share «${listing.title}» by ${listing.author} with ${listing.owner.name} in ${listing.city}.`,
    }),
    alternates: { canonical: `/libro/${listing.id}` },
    openGraph: {
      type: "book",
      title: `${listing.title} — ${listing.author}`,
      description: pick(locale, {
        es: `Ejemplar compartido por ${listing.owner.name} en ${listing.city}.`,
        de: `Exemplar von ${listing.owner.name} in ${listing.city}.`,
        en: `Copy shared by ${listing.owner.name} in ${listing.city}.`,
      }),
      url: `/libro/${listing.id}`,
      images: listing.coverUrl ? [listing.coverUrl] : undefined,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  const user = await requirePageUser(`/libro/${id}`);
  const listing = getListing(id, user?.id ?? null);
  if (!listing) notFound();

  // Mismo filtro que el hilo de la obra: sin bloqueos ni cuentas suspendidas.
  const comments = countBookComments(listing.bookId, user?.id ?? null);

  return (
    <SiteShell user={user} section="obra" title={listing.title}>
      <article className="book-detail">
        <div className={`book-detail-cover tone-${toneForId(listing.id)}`}>
          <BookCover
            id={listing.id}
            title={listing.title}
            author={listing.author}
            coverUrl={listing.coverUrl}
            sizes="(max-width: 700px) 70vw, 280px"
          />
          <span className="condition-tag">{t(listing.condition)}</span>
        </div>

        <div className="book-detail-info">
          <h1>{listing.title}</h1>
          <p className="book-detail-author">{listing.author}</p>

          {listing.notes && <p className="detail-notes">{listing.notes}</p>}

          <dl className="detail-facts">
            <div>
              <dt>{t("Estado")}</dt>
              <dd>{t(listing.condition)}</dd>
            </div>
            <div>
              <dt>{t("Ciudad")}</dt>
              <dd>{listing.city}</dd>
            </div>
            <div>
              <dt>{t("Distancia")}</dt>
              <dd>{formatDistance(listing.distanceKm, locale)}</dd>
            </div>
            {listing.isbn && (
              <div>
                <dt>ISBN</dt>
                <dd>{listing.isbn}</dd>
              </div>
            )}
            <div>
              <dt>{t("Publicado")}</dt>
              <dd>{formatWhen(listing.createdAt, locale)}</dd>
            </div>
          </dl>

          <Link href={`/obra/${listing.bookId}`} className="work-link">
            <MessageCircle size={15} />
            {comments === 0
              ? t("Abrir la conversación sobre este libro")
              : comments === 1
                ? t("1 comentario sobre este libro")
                : t("{n} comentarios sobre este libro", { n: comments })}
          </Link>

          <Link href={`/u/${listing.owner.id}`} className="owner-badge">
            <span className={`avatar tone-${toneForId(listing.owner.id)}`}>
              {initialsOf(listing.owner.name)}
            </span>
            <span>
              <strong>{listing.isMine ? t("Tu publicación") : listing.owner.name}</strong>
              <small>
                <MapPin size={11} /> {listing.city}
              </small>
            </span>
          </Link>

          {/* El género cierra el bloque de datos. Las acciones van fuera, en
              una barra a todo el ancho bajo la portada. */}
          <span className="book-category">{t(listing.category)}</span>
        </div>

        <ListingActions
          listingId={listing.id}
          bookId={listing.bookId}
          hasUploadedCover={listing.coverUrl?.startsWith("/api/cover/book/") ?? false}
          listingTitle={listing.title}
          ownerName={listing.owner.name}
          status={listing.status}
          isMine={listing.isMine}
          isFavorite={listing.isFavorite}
          isAuthenticated={Boolean(user)}
          myRequestStatus={listing.myRequestStatus}
          condition={listing.condition}
          category={listing.category}
          city={listing.city}
          notes={listing.notes}
          tags={listing.tags}
          author={listing.author}
          language={listing.language}
          publisher={listing.publisher}
          year={listing.year}
          series={listing.series}
        />
      </article>

      <p className="detail-footer">
        {t("Wanderbibliothek no aloja archivos: los intercambios son de ejemplares físicos entre lectores.")}
      </p>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Book",
            name: listing.title,
            author: { "@type": "Person", name: listing.author },
            ...(listing.isbn ? { isbn: listing.isbn } : {}),
            offers: {
              "@type": "Offer",
              areaServed: {
                "@type": "City",
                name: listing.city,
                containedInPlace: {
                  "@type": "AdministrativeArea",
                  name: regionName(locale),
                },
              },
              price: 0,
              priceCurrency: "EUR",
              availability:
                listing.status === "available"
                  ? "https://schema.org/InStock"
                  : "https://schema.org/OutOfStock",
            },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </SiteShell>
  );
}
