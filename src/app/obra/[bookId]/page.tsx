import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MapPin, MessageCircle, Users } from "lucide-react";
import { BookComments } from "@/components/book-comments";
import { BookCover } from "@/components/book-cover";
import { BookWantButton } from "@/components/book-want-button";
import { ReadingStateButtons } from "@/components/reading-state-buttons";
import { ListingCard } from "@/components/listing-card";
import { SiteShell } from "@/components/site-shell";
import { requirePageUser } from "@/lib/page-auth";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { regionName } from "@/lib/cities";
import { socialMetadata } from "@/lib/social";import { pick } from "@/lib/locale";
import { ListPicker } from "@/components/list-picker";
import {
  countBookWants,
  countListingsForBook,
  countReadingStates,
  getBook,
  getReadingState,
  isBookWanted,
  listBookComments,
  listIdsContainingBook,
  listReadingLists,
  listingsForBook,
  similarListings,
  workBooks,
} from "@/lib/repo";
import { toneForId } from "@/lib/text";

type PageProps = { params: Promise<{ bookId: string }> };

export const instant = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { bookId } = await params;
  const locale = await getLocale();
  const book = getBook(bookId);
  if (!book) {
    return {
      title: pick(locale, {
        es: "Libro no encontrado",
        de: "Buch nicht gefunden",
        en: "Book not found",
      }),
    };
  }
  // Las ediciones comparten obra: la canónica es la primera, para no repartir
  // el posicionamiento entre varias URL del mismo libro.
  const canonicalId = workBooks(book.id)[0]?.id ?? book.id;
  return {
    title: `${book.title} — ${book.author}`,
    description: pick(locale, {
      es: `Conversación y ejemplares disponibles de «${book.title}» de ${book.author} en toda Europa.`,
      de: `Gespräch und verfügbare Exemplare von «${book.title}» von ${book.author} in ganz Europa.`,
      en: `Discussion and available copies of «${book.title}» by ${book.author} across Europe.`,
    }),
    alternates: { canonical: `/obra/${canonicalId}` },
    ...socialMetadata({
      locale,
      path: `/obra/${book.id}`,
      title: `${book.title} — ${book.author}`,
      description: pick(locale, {
        es: `Comenta «${book.title}» y descubre quién lo tiene cerca.`,
        de: `Sprich über «${book.title}» und entdecke, wer es in deiner Nähe hat.`,
        en: `Talk about «${book.title}» and find out who has it near you.`,
      }),
      image: book.coverUrl,
      type: "book",
    }),
  };
}

export default async function Page({ params }: PageProps) {
  const { bookId } = await params;
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  const viewer = await requirePageUser(`/obra/${bookId}`);
  const book = getBook(bookId);
  if (!book) notFound();
  // Todas las ediciones de la obra: la primera es la canónica (la URL buena) y
  // el resto se enseñan como «otras ediciones».
  const versions = workBooks(book.id);
  const primary = versions[0] ?? book;
  const otherVersions = versions.filter((version) => version.id !== primary.id);

  const commentViewer = viewer ? { id: viewer.id, isAdmin: viewer.isAdmin } : null;
  const thread = listBookComments(book.id, commentViewer);
  const copies = listingsForBook(book.id, viewer?.id ?? null);
  const copiesTotal = countListingsForBook(book.id, viewer?.id ?? null);
  const similar = similarListings(book.id, viewer?.id ?? null);
  const myLists = viewer ? listReadingLists(viewer.id, viewer.id) : [];
  const inLists = viewer ? listIdsContainingBook(viewer.id, book.id) : [];
  const wanted = viewer ? isBookWanted(viewer.id, book.id) : false;
  const wantCount = viewer ? countBookWants(book.id, viewer.city, viewer.id) : 0;
  const readingStatus = viewer ? getReadingState(viewer.id, book.id) : null;
  const readingCounts = countReadingStates(book.id);
  // Las etiquetas son del ejemplar: se muestran las del primero disponible.
  const tags = [...new Set(copies.flatMap((copy) => copy.tags))];

  return (
    <SiteShell user={viewer} section="obra" title={book.title}>
      <article className="work-hero">
        <div className={`work-cover tone-${toneForId(book.id)}`}>
          <BookCover
            id={book.id}
            title={book.title}
            author={book.author}
            coverUrl={book.coverUrl}
            sizes="200px"
          />
        </div>
        <div className="work-info">
          <span className="book-category">{t(book.category)}</span>
          {tags.length > 0 && (
            <div className="tag-row">
              {tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/?tag=${encodeURIComponent(tag)}`}
                  className="tag-chip"
                >
                  {t(tag)}
                </Link>
              ))}
            </div>
          )}
          <h1>{book.title}</h1>
          <p className="book-detail-author">{book.author}</p>
          <ul className="work-facts">
            <li>
              <Users size={14} />{" "}
              {copiesTotal === 1 ? t("1 ejemplar") : t("{n} ejemplares", { n: copiesTotal })}
            </li>
            <li>
              <MessageCircle size={14} />{" "}
              {thread.total === 1 ? t("1 comentario") : t("{n} comentarios", { n: thread.total })}
            </li>
            {book.isbn && <li>ISBN {book.isbn}</li>}
            {(book.publisher || book.year) && (
              <li>
                {[book.publisher, book.year].filter(Boolean).join(", ")}
              </li>
            )}
            {book.series && <li>{book.series}</li>}
            {otherVersions.length > 0 && (
              <li>
                {otherVersions.length === 1
                  ? t("1 edición más")
                  : t("{n} ediciones más", { n: otherVersions.length })}
              </li>
            )}
            {book.language && book.language !== "No especificado" && (
              <li>{t(book.language)}</li>
            )}
            <li>
              <MapPin size={14} /> {regionName(locale)}
            </li>
          </ul>
        </div>
      </article>

      <div className="work-social">
        <ListPicker
          bookId={book.id}
          lists={myLists}
          isAuthenticated={Boolean(viewer)}
          inLists={inLists}
        />
        <Link href={`/clubes?book=${book.id}`} className="work-link">
          <Users size={15} /> {t("Crear un club con este libro")}
        </Link>
        {viewer && (
          <BookWantButton
            bookId={book.id}
            initialWanted={wanted}
            initialCount={wantCount}
          />
        )}
        {viewer && (
          <ReadingStateButtons
            bookId={book.id}
            initialStatus={readingStatus}
            initialReading={readingCounts.reading}
            initialRead={readingCounts.read}
          />
        )}
      </div>

      <BookComments
        bookId={book.id}
        initialComments={thread.comments}
        initialHasMore={thread.hasMore}
        total={thread.total}
        isAuthenticated={Boolean(viewer)}
      />

      <section className="work-copies" aria-labelledby="copies-title">
        <div className="feed-header">
          <div>
            <strong id="copies-title">{t("Ejemplares disponibles")}</strong>
            <span>{t("Este mismo libro en manos de otras personas de toda Europa")}</span>
          </div>
        </div>
        {copies.length === 0 ? (
          <p className="empty-note">
            {t("Ahora mismo nadie ha publicado este título. Puedes ser la primera persona en compartirlo.")}
          </p>
        ) : (
          <div className="book-grid">
            {copies.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>

      {otherVersions.length > 0 && (
        <section className="work-copies" aria-labelledby="editions-title">
          <div className="feed-header">
            <div>
              <strong id="editions-title">{t("Otras ediciones de esta obra")}</strong>
              <span>{t("Mismo libro, distinto ISBN: los ejemplares y la conversación son los mismos.")}</span>
            </div>
          </div>
          <ul className="edition-list">
            {otherVersions.map((edition) => (
              <li key={edition.id}>
                <Link href={`/obra/${edition.id}`}>
                  <strong>{edition.title}</strong>
                </Link>
                <span>
                  {edition.author}
                  {edition.isbn ? ` · ISBN ${edition.isbn}` : ""}
                  {edition.language && edition.language !== "No especificado"
                    ? ` · ${t(edition.language)}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {similar.length > 0 && (
        <section className="work-copies" aria-labelledby="similar-title">
          <div className="feed-header">
            <div>
              <strong id="similar-title">{t("También te puede interesar")}</strong>
              <span>{t("Otras lecturas de la misma categoría o con etiquetas en común.")}</span>
            </div>
          </div>
          <div className="book-grid">
            {similar.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Book",
            name: book.title,
            author: { "@type": "Person", name: book.author },
            ...(book.isbn ? { isbn: book.isbn } : {}),
            inLanguage: locale,
            discussionUrl: `/obra/${book.id}#comentarios`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </SiteShell>
  );
}
