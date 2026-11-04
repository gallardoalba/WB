"use client";

import { MapPin, Lock, ArrowRight } from "lucide-react";
import { Dialog } from "./dialog";
import { BookCover } from "./book-cover";
import { useI18n } from "./i18n-provider";
import type { ListingView } from "@/lib/domain";

/**
 * Vista previa para quien aún no ha entrado: enseña lo esencial del ejemplar
 * sin abrir la ficha completa (que exige sesión). Así el catálogo no es un
 * callejón sin salida y el acceso conserva el contexto.
 */
export function ListingPreview({
  listing,
  onClose,
  onLogin,
}: {
  listing: ListingView | null;
  onClose: () => void;
  onLogin: () => void;
}) {
  const { t, locale } = useI18n();
  if (!listing) return null;

  return (
    <Dialog
      open={Boolean(listing)}
      onClose={onClose}
      title={listing.title}
      description={`${listing.author} · ${listing.city}`}
      overline={t(listing.category)}
      icon={<Lock size={20} />}
    >
      <div className="listing-preview">
        <div className="preview-cover">
          <BookCover id={listing.id} title={listing.title} coverUrl={listing.coverUrl} />
        </div>
        <div className="preview-copy">
          <span className="condition-tag">{t(listing.condition)}</span>
          <p className="preview-line">
            <MapPin size={14} />
            {listing.city}
            {listing.distanceKm !== null && ` · ${listing.distanceKm.toLocaleString(locale)} km`}
          </p>
          {listing.tags.length > 0 && (
            <p className="preview-tags">
              {listing.tags.map((tag) => (
                <span key={tag} className="tag-chip">
                  {t(tag)}
                </span>
              ))}
            </p>
          )}
          {listing.notes && <p className="preview-notes">{listing.notes}</p>}
          <p className="preview-owner">
            {t("Compartido por {name}", { name: listing.owner.name })}
          </p>
        </div>
      </div>
      <p className="form-note">
        {t("Entra para ver la ficha completa, guardarlo o pedirlo. Después volverás a este libro.")}
      </p>
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onClose}>
          {t("Seguir explorando")}
        </button>
        <button type="button" className="share-button" onClick={onLogin}>
          {t("Entrar para pedirlo")} <ArrowRight size={15} />
        </button>
      </div>
    </Dialog>
  );
}
