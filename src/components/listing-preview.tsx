"use client";

import { ArrowRight, Lock } from "lucide-react";
import { Dialog } from "./dialog";
import { BookCover } from "./book-cover";
import { useI18n } from "./i18n-provider";
import type { ListingView } from "@/lib/domain";
import { STATUS_RIBBON } from "@/lib/listing-status";
import { initialsOf, toneForId } from "@/lib/text";

/**
 * Vista previa para quien aún no ha entrado: enseña lo esencial del ejemplar
 * sin abrir la ficha completa (que exige sesión). Así el catálogo no es un
 * callejón sin salida y el acceso conserva el contexto.
 *
 * Se muestran los datos que ya vienen con el ejemplar en el catálogo (estado,
 * ciudad e idioma) y la nota de quien lo publica, en vez de una tarjeta
 * escueta: lo que decide si se pide un libro es saber qué ejemplar es y qué
 * pasa al pedirlo, y eso se puede contar sin sesión. La ficha bibliográfica
 * completa se deja para la página del libro, que ya pide cuenta.
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
  const { t } = useI18n();
  if (!listing) return null;

  // Solo las filas con dato: rellenar huecos con «—» no informa de nada.
  const facts = [
    { label: t("Estado"), value: t(listing.condition) },
    { label: t("Ciudad"), value: listing.city },
    { label: t("Idioma del libro"), value: t(listing.language) },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));

  return (
    <Dialog
      open={Boolean(listing)}
      onClose={onClose}
      title={listing.title}
      description={listing.author}
      icon={<Lock size={20} />}
      className="preview-dialog"
    >
      <div className="listing-preview">
        <div className="preview-cover">
          <BookCover
            id={listing.id}
            title={listing.title}
            author={listing.author}
            coverUrl={listing.coverUrl}
          />
          {listing.status !== "available" && (
            <span className="status-ribbon">
              {t(STATUS_RIBBON[listing.status] ?? listing.status)}
            </span>
          )}
        </div>
        <div className="preview-copy">
          <span className="book-category">{t(listing.category)}</span>
          {listing.tags.length > 0 && (
            <p className="preview-tags" aria-label={t("Temas")}>
              {listing.tags.map((tag) => (
                <span key={tag} className="tag-chip">
                  {t(tag)}
                </span>
              ))}
            </p>
          )}
          {listing.notes && (
            <div className="preview-note">
              <h3>{t("Nota de quien lo comparte")}</h3>
              <p>{listing.notes}</p>
            </div>
          )}
          <dl className="detail-facts preview-facts">
            {facts.map((fact, index) => (
              <div key={index}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="preview-owner">
        <span className={`avatar tone-${toneForId(listing.owner.id)}`}>
          {initialsOf(listing.owner.name)}
        </span>
        {t("Compartido por {name}", { name: listing.owner.name })}
      </p>

      <section className="preview-how">
        <h3>{t("Cómo funciona el intercambio")}</h3>
        <ol>
          <li>{t("Pides el libro a quien lo comparte.")}</li>
          <li>{t("Acordáis la entrega en mano o por correo.")}</li>
          <li>{t("Habláis por un chat cifrado de extremo a extremo.")}</li>
        </ol>
      </section>

      <p className="form-note">
        {t("Entra para ver la ficha completa, guardarlo o pedirlo.")}
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
