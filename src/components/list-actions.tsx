"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { ConfirmDialog } from "./confirm-dialog";
import { useI18n } from "./i18n-provider";

/** Borra una lista propia y devuelve al catálogo. */
export function ListDeleteButton({ listId }: { listId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    setConfirming(false);
    setPending(true);
    setError("");
    try {
      await api(`/api/lists/${listId}`, { method: "DELETE" });
      router.push("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo borrar la lista."));
      setPending(false);
    }
  }

  return (
    <div className="list-delete">
      <button
        type="button"
        className="secondary-button small danger"
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        <Trash2 size={14} /> {t("Borrar lista")}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void remove()}
        title={t("Borrar la lista")}
        description={t("La lista desaparecerá, pero los libros seguirán en el catálogo.")}
        confirmLabel={t("Borrar lista")}
        pending={pending}
      />
    </div>
  );
}

/** Edición del título y la descripción de una lista propia. */
export function ListEditForm({
  listId,
  title,
  description,
  showOwner,
}: {
  listId: string;
  title: string;
  description: string;
  showOwner: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await api(`/api/lists/${listId}`, {
        method: "PATCH",
        body: {
          title: form.get("title"),
          description: form.get("description") ?? "",
          showOwner: form.get("showOwner") !== null,
        },
      });
      setDone(true);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo guardar la lista."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="list-edit">
      <button type="button" className="secondary-button small" onClick={() => setOpen((v) => !v)}>
        <Pencil size={14} /> {t("Editar lista")}
      </button>
      {done && (
        <span className="action-feedback" role="status">
          {t("Lista actualizada.")}
        </span>
      )}
      {open && (
        <form className="list-picker-form" onSubmit={submit}>
          <label className="sr-only" htmlFor={`list-title-${listId}`}>
            {t("Título")}
          </label>
          <input
            id={`list-title-${listId}`}
            name="title"
            defaultValue={title}
            required
            minLength={3}
            maxLength={60}
          />
          <label className="sr-only" htmlFor={`list-desc-${listId}`}>
            {t("Descripción")}
          </label>
          <input
            id={`list-desc-${listId}`}
            name="description"
            defaultValue={description}
            maxLength={280}
            placeholder={t("Descripción (opcional)")}
          />
          <label className="checkbox-row">
            <input type="checkbox" name="showOwner" defaultChecked={showOwner} />
            <span>{t("Mostrar mi nombre en la lista pública")}</span>
          </label>
          <button type="submit" className="secondary-button small" disabled={pending}>
            {t("Guardar")}
          </button>
          {error && (
            <span className="form-error" role="alert">
              {error}
            </span>
          )}
        </form>
      )}
    </div>
  );
}

/** Quita una obra de la lista (solo su dueño). */
export function ListRemoveButton({ listId, bookId }: { listId: string; bookId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setPending(true);
    setError("");
    try {
      await api(`/api/lists/${listId}/items?bookId=${encodeURIComponent(bookId)}`, {
        method: "DELETE",
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo quitar el libro."));
      setPending(false);
    }
  }

  return (
    <span className="list-remove">
      <button
        type="button"
        className="comment-action danger"
        disabled={pending}
        onClick={remove}
        aria-label={t("Quitar de la lista")}
      >
        <X size={13} /> {t("Quitar")}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
