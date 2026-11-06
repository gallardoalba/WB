"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Heart,
  Pause,
  Pencil,
  Play,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { BookCoverUpload } from "./book-cover-upload";
import { CityField } from "./city-field";
import { ConfirmDialog } from "./confirm-dialog";
import { Dialog } from "./dialog";
import { RequestDialog } from "./dialogs/request-dialog";
import { useI18n } from "./i18n-provider";
import {
  BOOK_LANGUAGES,
  CATEGORIES,
  CONDITIONS,
  REPORT_REASONS,
  REQUEST_STATUS_LABELS,
  tagsForCategory,
  type ListingStatus,
  type RequestStatus,
} from "@/lib/domain";

type Props = {
  listingId: string;
  /** Obra a la que pertenece el ejemplar: la portada subida es de la obra. */
  bookId: string;
  /** Ya hay una portada subida a mano (se puede quitar). */
  hasUploadedCover: boolean;
  listingTitle: string;
  /** Quien publica: la solicitud se la manda a esta persona. */
  ownerName: string;
  status: ListingStatus;
  isMine: boolean;
  isFavorite: boolean;
  isAuthenticated: boolean;
  myRequestStatus: RequestStatus | null;
  condition: string;
  category: string;
  city: string;
  notes: string;
  tags: string[];
  /** Ficha de la obra: se puede corregir sin volver a publicar. */
  author: string;
  language: string;
  publisher: string | null;
  year: string | null;
  series: string | null;
};

export function ListingActions({
  listingId,
  bookId,
  hasUploadedCover,
  listingTitle,
  ownerName,
  status,
  isMine,
  isFavorite,
  isAuthenticated,
  myRequestStatus,
  condition,
  category,
  city,
  notes,
  tags,
  author,
  language,
  publisher,
  year,
  series,
}: Props) {
  const { t } = useI18n();
  // Las etiquetas ya guardadas se muestran siempre, aunque el género haya
  // cambiado: así se ven y se pueden quitar a mano en vez de desaparecer solas.
  const categoryTags = tagsForCategory(category);
  const editTags = [
    ...categoryTags,
    ...tags.filter((tag) => !categoryTags.includes(tag as never)),
  ];
  const router = useRouter();
  const [favorite, setFavorite] = useState(isFavorite);
  const [requesting, setRequesting] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [reporting, setReporting] = useState(false);

  async function run(action: () => Promise<void>, success: string) {
    setPending(true);
    setError("");
    try {
      await action();
      setFeedback(success);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo completar la acción."));
    } finally {
      setPending(false);
    }
  }

  async function toggleFavorite() {
    const next = !favorite;
    setFavorite(next);
    setPending(true);
    setError("");
    try {
      await api(`/api/listings/${listingId}/favorite`, {
        method: "POST",
        body: { favorite: next },
      });
      setFeedback(next ? t("Guardado en tu estantería.") : t("Quitado de tu estantería."));
      router.refresh();
    } catch (caught) {
      setFavorite(!next);
      setError(caught instanceof Error ? caught.message : t("No se pudo actualizar tu estantería."));
    } finally {
      setPending(false);
    }
  }

  async function removeListing() {
    setConfirmingRemove(false);
    setPending(true);
    setError("");
    try {
      await api(`/api/listings/${listingId}`, { method: "DELETE" });
      router.push("/estanteria");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo retirar la publicación."));
      setPending(false);
    }
  }


  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(
      async () => {
        await api(`/api/listings/${listingId}`, {
          method: "PATCH",
          body: {
            condition: form.get("condition"),
            city: form.get("city"),
            notes: form.get("notes") ?? "",
            tags: form.getAll("tags").map(String),
            title: form.get("title"),
            author: form.get("author"),
            category: form.get("category"),
            language: form.get("language"),
            publisher: form.get("publisher") ?? "",
            year: form.get("year") ?? "",
            series: form.get("series") ?? "",
          },
        });
      },
      t("Publicación actualizada."),
    );
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await api("/api/reports", {
        method: "POST",
        body: {
          targetType: "listing",
          targetId: listingId,
          reason: form.get("reason"),
          details: form.get("details") ?? "",
        },
      });
      setReporting(false);
      setFeedback(t("Denuncia registrada. Gracias por avisar."));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo completar la acción."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="detail-actions">
      {feedback && (
        <p className="action-feedback" role="status">
          <Check size={14} /> {feedback}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {isMine ? (
        <div className="owner-actions">
          {status === "available" && (
            <button
              type="button"
              className="secondary-button small"
              disabled={pending}
              onClick={() =>
                run(
                  () => api(`/api/listings/${listingId}`, { method: "PATCH", body: { status: "paused" } }),
                  t("Publicación pausada."),
                )
              }
            >
              <Pause size={14} /> {t("Pausar")}
            </button>
          )}
          {status === "paused" && (
            <button
              type="button"
              className="secondary-button small"
              disabled={pending}
              onClick={() =>
                run(
                  () => api(`/api/listings/${listingId}`, { method: "PATCH", body: { status: "available" } }),
                  t("Publicación reactivada."),
                )
              }
            >
              <Play size={14} /> {t("Reactivar")}
            </button>
          )}
          <button
            type="button"
            className="secondary-button small danger"
            disabled={pending || status === "reserved"}
            onClick={() => setConfirmingRemove(true)}
          >
            <Trash2 size={14} /> {t("Retirar")}
          </button>

          <details className="edit-box">
            <summary>
              <Pencil size={14} /> {t("Editar detalles")}
            </summary>
            <form onSubmit={submitEdit}>
              <label htmlFor="edit-title">{t("Título")}</label>
              <input
                id="edit-title"
                name="title"
                defaultValue={listingTitle}
                required
                minLength={2}
                maxLength={120}
              />
              <label htmlFor="edit-author">{t("Autoría")}</label>
              <input
                id="edit-author"
                name="author"
                defaultValue={author}
                required
                minLength={2}
                maxLength={90}
              />
              <label htmlFor="edit-category">{t("Género")}</label>
              <select id="edit-category" name="category" defaultValue={category}>
                {CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {t(option)}
                  </option>
                ))}
              </select>
              <label htmlFor="edit-language">{t("Idioma del libro")}</label>
              <select id="edit-language" name="language" defaultValue={language}>
                {BOOK_LANGUAGES.map((option) => (
                  <option key={option} value={option}>
                    {t(option)}
                  </option>
                ))}
              </select>
              <label htmlFor="edit-publisher">{t("Editorial")}</label>
              <input
                id="edit-publisher"
                name="publisher"
                defaultValue={publisher ?? ""}
                maxLength={80}
              />
              <label htmlFor="edit-year">{t("Año de edición")}</label>
              <input id="edit-year" name="year" defaultValue={year ?? ""} maxLength={12} />
              <label htmlFor="edit-series">{t("Colección")}</label>
              <input
                id="edit-series"
                name="series"
                defaultValue={series ?? ""}
                maxLength={80}
              />
              <p className="form-note">
                {t("Los cambios de la ficha valen para todas las copias de este título.")}
              </p>
              <label htmlFor="edit-condition">{t("Estado")}</label>
              <select id="edit-condition" name="condition" defaultValue={condition}>
                {CONDITIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(option)}
                  </option>
                ))}
              </select>
              <label htmlFor="edit-city">{t("Ciudad")}</label>
              <CityField id="edit-city" name="city" defaultValue={city} required />
              <fieldset className="tag-field">
                <legend>{t("Etiquetas (hasta 3)")}</legend>
                <div className="tag-options">
                  {editTags.map((option) => (
                    <label key={option} className="tag-option">
                      <input
                        type="checkbox"
                        name="tags"
                        value={option}
                        defaultChecked={tags.includes(option)}
                      />{" "}
                      {t(option)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label htmlFor="edit-notes">{t("Notas para quien lo recoja")}</label>
              <textarea id="edit-notes" name="notes" defaultValue={notes} rows={2} maxLength={300} />

              {/* La portada vive dentro de la edición, pero se guarda al
                  momento (no al enviar el formulario): es una imagen, no un
                  campo de texto. Los botones son `type="button"`. */}
              <fieldset className="edit-cover">
                <legend className="edit-cover-title">{t("Portada del libro")}</legend>
                <BookCoverUpload bookId={bookId} hasUploaded={hasUploadedCover} />
              </fieldset>

              <button className="secondary-button small" type="submit" disabled={pending}>
                {t("Guardar cambios")}
              </button>
            </form>
          </details>
        </div>
      ) : myRequestStatus ? (
        <p className="unavailable-note">
          {t("Tu solicitud está {status}. Puedes seguirla en Intercambios.", { status: t(REQUEST_STATUS_LABELS[myRequestStatus]).toLowerCase() })}
        </p>
      ) : status === "available" ? (
        !isAuthenticated ? (
          <Link className="share-button" href={`/?auth=1&next=${encodeURIComponent(`/libro/${listingId}`)}`}>
            {t("Inicia sesión para pedirlo")} <ArrowRight size={16} />
          </Link>
        ) : (
          <button type="button" className="share-button" onClick={() => setRequesting(true)}>
            {t("Pedir este libro")} <ArrowRight size={16} />
          </button>
        )
      ) : (
        <p className="unavailable-note">
          {status === "paused"
            ? t("Esta persona ha pausado la publicación.")
            : t("Este ejemplar ya no está disponible.")}
        </p>
      )}

      {isAuthenticated && !isMine && (
        <div className="secondary-actions">
          <button
            type="button"
            className={favorite ? "favorite-inline is-favorite" : "favorite-inline"}
            aria-pressed={favorite}
            disabled={pending}
            onClick={toggleFavorite}
          >
            <Heart size={15} fill={favorite ? "currentColor" : "none"} />
            {favorite ? t("Guardado") : t("Guardar")}
          </button>

          <button
            type="button"
            className="report-inline"
            disabled={pending}
            onClick={() => setReporting(true)}
          >
            <TriangleAlert size={15} /> {t("Denunciar")}
          </button>
        </div>
      )}

      {/* La denuncia va en ventana emergente: es un formulario largo y dentro
          de la barra obligaba a desplegarla en mitad de la ficha. */}
      <Dialog
        open={reporting}
        onClose={() => setReporting(false)}
        title={t("Denunciar este ejemplar")}
        description={t(
          "Cuéntanos qué ocurre con «{title}». Lo revisa el equipo y no se le avisa a quien lo publica.",
          { title: listingTitle },
        )}
        icon={<TriangleAlert size={20} />}
      >
        <form className="listing-form" onSubmit={submitReport}>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <label htmlFor="report-reason">{t("Motivo")}</label>
          <select id="report-reason" name="reason" defaultValue={REPORT_REASONS[0]}>
            {REPORT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(reason)}
              </option>
            ))}
          </select>
          <label htmlFor="report-details">{t("Detalles (opcional)")}</label>
          <textarea id="report-details" name="details" rows={3} maxLength={500} />

          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setReporting(false)}
              disabled={pending}
            >
              {t("Cancelar")}
            </button>
            <button type="submit" className="secondary-button danger" disabled={pending}>
              {pending ? t("Enviando…") : t("Enviar denuncia")}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        onConfirm={() => void removeListing()}
        title={t("Retirar el ejemplar")}
        description={t("«{title}» dejará de aparecer en el catálogo y se cerrarán las solicitudes pendientes.", { title: listingTitle })}
        confirmLabel={t("Retirar")}
        pending={pending}
      />

      {/* Pedir el libro abre una ventana: la solicitud es un paso aparte, no un
          formulario suelto en la barra de acciones. */}
      <RequestDialog
        open={requesting}
        onClose={() => setRequesting(false)}
        listing={{ id: listingId, title: listingTitle, ownerName }}
        onCreated={() => {
          setFeedback(t("Solicitud enviada. Podrás seguirla en Intercambios."));
          router.refresh();
        }}
      />
    </div>
  );
}
