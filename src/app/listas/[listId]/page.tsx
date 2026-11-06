import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookOpen, MessageCircle } from "lucide-react";
import { ListDeleteButton, ListEditForm, ListRemoveButton } from "@/components/list-actions";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { getSessionUser } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { getReadingList } from "@/lib/repo";
import { formatWhen } from "@/lib/text";

type PageProps = { params: Promise<{ listId: string }> };

export const instant = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { listId } = await params;
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  const list = getReadingList(listId, null);
  if (!list) {
    return { title: t("Lista no encontrada"), robots: { index: false, follow: false } };
  }
  // El nombre solo viaja a los buscadores si quien firma lo ha aceptado.
  const signature = list.showOwner ? t(" de {name}", { name: list.owner.name }) : "";
  return {
    title: list.title,
    description: t("{n} libros en la lista «{title}»{signature}.", {
      n: list.items,
      title: list.title,
      signature,
    }),
    alternates: { canonical: `/listas/${list.id}` },
    robots: list.items > 0 ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: "article",
      title: list.title,
      description: list.description || t("{n} libros recomendados.", { n: list.items }),
      url: `/listas/${list.id}`,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { listId } = await params;
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  const viewer = await getSessionUser();
  const list = getReadingList(listId, viewer?.id ?? null);
  if (!list) notFound();

  const signature = viewer || list.showOwner ? list.owner.name : t("Una persona de la comunidad");
  // Dentro de la sesión se entra a la ficha con conversación; fuera, a la
  // ficha pública de la obra (que no publica datos de nadie).
  const bookHref = (bookId: string) => (viewer ? `/obra/${bookId}` : `/werk/${bookId}`);

  return (
    <SiteShell user={viewer} section="listas" title={list.title}>
      <PageHeader
        overline={t("LISTA DE LECTURA")}
        title={list.title}
        description={
          <>
            {list.description && `${list.description} · `}
            {signature} · {formatWhen(list.createdAt, locale)} ·{" "}
            {list.items === 1 ? t("1 libro") : t("{n} libros", { n: list.items })}
          </>
        }
        aside={
          list.isMine ? (
            <div className="list-tools">
              <ListEditForm
                listId={list.id}
                title={list.title}
                description={list.description}
                showOwner={list.showOwner}
              />
              <ListDeleteButton listId={list.id} />
            </div>
          ) : undefined
        }
      />

      {list.books.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <BookOpen size={22} />
          </span>
          <h3>{t("Lista vacía")}</h3>
          <p>{t("Añade libros desde la página de cualquier obra.")}</p>
        </div>
      ) : (
        <ol className="list-books">
          {list.books.map((book) => (
            <li key={book.bookId} className="list-book">
              <Link href={bookHref(book.bookId)} className="list-book-title">
                {book.title}
              </Link>
              <span className="list-book-author">{book.author}</span>
              <span className="list-book-meta">
                <MessageCircle size={13} />{" "}
                {book.comments === 1 ? t("1 comentario") : t("{n} comentarios", { n: book.comments })}
              </span>
              {list.isMine && <ListRemoveButton listId={list.id} bookId={book.bookId} />}
            </li>
          ))}
        </ol>
      )}

      <p className="detail-footer">
        {t("Las listas son públicas: sirven para recomendar, no para guardar direcciones.")}
      </p>
    </SiteShell>
  );
}
