"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, MapPin } from "lucide-react";
import { BookCover } from "./book-cover";
import type { ListingView } from "@/lib/domain";
import { STATUS_RIBBON } from "@/lib/listing-status";
import { initialsOf, toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";

export function ListingCard({
  listing,
  actions,
  onPreview,
}: {
  listing: ListingView;
  actions?: ReactNode;
  onPreview?: () => void;
}) {
  const { t } = useI18n();
  const preview = (event: React.MouseEvent) => {
    if (!onPreview) return;
    event.preventDefault();
    onPreview();
  };
  return (
    <article className="book-card">
      <div className={`cover-frame tone-${toneForId(listing.id)}`}>
        {/* La portada también abre la ficha: es lo primero que se pulsa. El
            enlace va oculto para lectores de pantalla y fuera del tabulador
            porque el título de al lado ya lleva al mismo sitio. */}
        <Link
          href={`/libro/${listing.id}`}
          className="cover-link"
          onClick={preview}
          aria-hidden="true"
          tabIndex={-1}
        >
          <BookCover
            id={listing.id}
            title={listing.title}
            author={listing.author}
            coverUrl={listing.coverUrl}
          />
        </Link>
        <span className="condition-tag">{t(listing.condition)}</span>
        {actions}
        {listing.status !== "available" && (
          <span className="status-ribbon">
            {t(STATUS_RIBBON[listing.status] ?? listing.status)}
          </span>
        )}
      </div>
      <div className="book-details">
        <h3>
          <Link href={`/libro/${listing.id}`} className="card-link" onClick={preview}>
            {listing.title}
          </Link>
        </h3>
        <p className="book-author">{listing.author}</p>
        <span className="book-category">{t(listing.category)}</span>
        {/* El hueco de etiquetas se reserva siempre: así la persona y el botón
            quedan a la misma altura en toda la fila del catálogo. */}
        <div
          className={
            listing.tags.length > 0
              ? "tag-row tag-row-cards"
              : "tag-row tag-row-cards tag-row-empty"
          }
          title={listing.tags.length > 0 ? listing.tags.join(" · ") : undefined}
        >
          {listing.tags.slice(0, 2).map((tag) => (
            <Link
              key={tag}
              href={`/descubrir?tag=${encodeURIComponent(tag)}`}
              className="tag-chip"
              title={t("Ver libros con la etiqueta {tag}", { tag: t(tag) })}
            >
              {t(tag)}
            </Link>
          ))}
        </div>
        <div className={listing.owner.masked ? "owner-row owner-row-anon" : "owner-row"}>
          {/* Sin sesión no hay autoría: ni avatar, ni nombre, ni iniciales.
              Queda la ciudad, que es lo que sirve para decidir si lo pides. */}
          {!listing.owner.masked && (
            <>
              <span className={`avatar owner-avatar tone-${toneForId(listing.owner.id)}`}>
                {initialsOf(listing.owner.name)}
              </span>
              <Link href={`/u/${listing.owner.id}`} className="owner-name">
                {listing.isMine ? t("Tú") : listing.owner.name}
              </Link>
            </>
          )}
          {listing.city && (
            <span className="distance">
              <MapPin size={12} />
              {listing.city}
            </span>
          )}
        </div>
        <Link href={`/libro/${listing.id}`} className="request-button" onClick={preview}>
          {onPreview ? t("Ver detalles") : t("Ver ficha y pedir")}
          <ArrowRight size={15} />
        </Link>
      </div>
    </article>
  );
}
