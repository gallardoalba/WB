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
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { CityField } from "./city-field";
import { ConfirmDialog } from "./confirm-dialog";
import { useI18n } from "./i18n-provider";
import {
  CONDITIONS,
  REPORT_REASONS,
  REQUEST_STATUS_LABELS,
  TAGS,
  type ListingStatus,
  type RequestStatus,
} from "@/lib/domain";

type Props = {
  listingId: string;
  listingTitle: string;
  status: ListingStatus;
  isMine: boolean;
  isFavorite: boolean;
  isAuthenticated: boolean;
  myRequestStatus: RequestStatus | null;
  condition: string;
  city: string;
  notes: string;
  tags: string[];
};

export function ListingActions({
  listingId,
  listingTitle,
  status,
  isMine,
  isFavorite,
  isAuthenticated,
  myRequestStatus,
  condition,
  city,
  notes,
  tags,
}: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [favorite, setFavorite] = useState(isFavorite);
  const [requesting, setRequesting] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState(false);

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
      router.push("/?view=shelf");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo retirar la publicación."));
      setPending(false);
    }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api("/api/requests", {
        method: "POST",
        body: { listingId },
      });
      setRequesting(false);
      setFeedback(t("Solicitud enviada. Podrás seguirla en Intercambios."));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo enviar la solicitud."));
    } finally {
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
          },
        });
      },
      t("Publicación actualizada."),
    );
  }

  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(
      async () => {
        await api("/api/reports", {
          method: "POST",
          body: {
            targetType: "listing",
            targetId: listingId,
            reason: form.get("reason"),
            details: form.get("details") ?? "",
          },
        });
      },
      t("Denuncia registrada. Gracias por avisar."),
    );
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
                  {TAGS.map((option) => (
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
        ) : requesting ? (
          <form className="request-inline" onSubmit={submitRequest}>
            <p className="form-note">
              {t("La solicitud no lleva ningún texto en claro. Cuando la acepten podréis coordinar la entrega en la conversación cifrada.")}
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button small"
                onClick={() => setRequesting(false)}
                disabled={pending}
              >
                {t("Cancelar")}
              </button>
              <button className="share-button small" type="submit" disabled={pending}>
                {pending ? t("Enviando…") : t("Enviar solicitud")} <Send size={14} />
              </button>
            </div>
          </form>
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

          <details className="report-box">
            <summary>
              <TriangleAlert size={14} /> {t("Denunciar")}
            </summary>
            <form onSubmit={report}>
              <label htmlFor="report-reason">{t("Motivo")}</label>
              <select id="report-reason" name="reason" defaultValue={REPORT_REASONS[0]}>
                {REPORT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {t(reason)}
                  </option>
                ))}
              </select>
              <label htmlFor="report-details">{t("Detalles (opcional)")}</label>
              <textarea id="report-details" name="details" rows={2} maxLength={500} />
              <button type="submit" className="secondary-button small" disabled={pending}>
                {t("Enviar denuncia")}
              </button>
            </form>
          </details>
        </div>
      )}

      <ConfirmDialog
        open={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        onConfirm={() => void removeListing()}
        title={t("Retirar el ejemplar")}
        description={t("«{title}» dejará de aparecer en el catálogo y se cerrarán las solicitudes pendientes.", { title: listingTitle })}
        confirmLabel={t("Retirar")}
        pending={pending}
      />
    </div>
  );
}
