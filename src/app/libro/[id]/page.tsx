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
import { getListing, countBookComments } from "@/lib/repo";
import { formatDistance, formatWhen, initialsOf, toneForId } from "@/lib/text";

type PageProps = { params: Promise<{ id: string }> };

export const instant = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const locale = await getLocale();
  const listing = getListing(id, null);
  if (!listing) return { title: locale === "de" ? "Buch nicht verfügbar" : "Libro no disponible" };
  return {
    title: `${listing.title} — ${listing.author}`,
    description:
      locale === "de"
        ? `Teile «${listing.title}» von ${listing.author} mit ${listing.owner.name} in ${listing.city}.`
        : `Comparte «${listing.title}» de ${listing.author} con ${listing.owner.name} en ${listing.city}.`,
    alternates: { canonical: `/libro/${listing.id}` },
    openGraph: {
      type: "book",
      title: `${listing.title} — ${listing.author}`,
      description:
        locale === "de"
          ? `Exemplar von ${listing.owner.name} in ${listing.city}.`
          : `Ejemplar compartido por ${listing.owner.name} en ${listing.city}.`,
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

  const comments = countBookComments(listing.bookId);

  return (
    <SiteShell user={user} section="obra" title={listing.title}>
      <article className="book-detail">
        <div className={`book-detail-cover tone-${toneForId(listing.id)}`}>
          <BookCover
            id={listing.id}
            title={listing.title}
            coverUrl={listing.coverUrl}
            sizes="(max-width: 700px) 70vw, 280px"
          />
          <span className="condition-tag">{t(listing.condition)}</span>
        </div>

        <div className="book-detail-info">
          <span className="book-category">{t(listing.category)}</span>
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

          <ListingActions
            listingId={listing.id}
            listingTitle={listing.title}
            status={listing.status}
            isMine={listing.isMine}
            isFavorite={listing.isFavorite}
            isAuthenticated={Boolean(user)}
            myRequestStatus={listing.myRequestStatus}
            condition={listing.condition}
            city={listing.city}
            notes={listing.notes}
            tags={listing.tags}
          />
        </div>
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
