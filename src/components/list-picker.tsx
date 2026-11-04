"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, ListPlus } from "lucide-react";
import { api } from "@/lib/client-api";
import type { ReadingListView } from "@/lib/domain";
import { useI18n } from "./i18n-provider";

/**
 * Añade una obra a una lista de lectura. Si la persona no tiene listas, puede
 * crear la primera sin salir de la ficha del libro.
 */
export function ListPicker({
  bookId,
  lists,
  isAuthenticated,
  inLists,
}: {
  bookId: string;
  lists: ReadingListView[];
  isAuthenticated: boolean;
  inLists: string[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [selected, setSelected] = useState(lists[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [added, setAdded] = useState<string[]>(inLists);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  if (!isAuthenticated) return null;

  const alreadyIn = (listId: string) => Boolean(listId) && added.includes(listId);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setError(t("Crea primero una lista."));
      return;
    }
    setPending(true);
    setError("");
    setFeedback("");
    try {
      await api(`/api/lists/${selected}/items`, { method: "POST", body: { bookId } });
      setAdded((current) => [...current, selected]);
      setFeedback(t("Añadido a la lista."));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo añadir a la lista."));
    } finally {
      setPending(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setFeedback("");
    try {
      await api<{ list: ReadingListView }>("/api/lists", {
        method: "POST",
        body: { title, description: "" },
      });
      setTitle("");
      setFeedback(t("Lista creada. Ya puedes añadir el libro desde el selector."));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo crear la lista."));
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="list-picker">
      <summary>
        <ListPlus size={15} /> {t("Añadir a una lista")}
      </summary>
      <div className="list-picker-body">
        {lists.length > 0 ? (
          <form onSubmit={add} className="list-picker-form">
            <label className="sr-only" htmlFor={`list-${bookId}`}>
              {t("Lista de lectura")}
            </label>
            <select
              id={`list-${bookId}`}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.title}
                  {added.includes(list.id) ? ` · ${t("ya está")}` : ""}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="secondary-button small"
              disabled={pending || alreadyIn(selected)}
              title={alreadyIn(selected) ? t("Este libro ya está en la lista") : undefined}
            >
              {alreadyIn(selected) ? t("Ya está") : t("Añadir")}
            </button>
          </form>
        ) : (
          <p className="empty-note">{t("Todavía no tienes listas.")}</p>
        )}

        <form onSubmit={create} className="list-picker-form">
          <label className="sr-only" htmlFor={`new-list-${bookId}`}>
            {t("Nueva lista")}
          </label>
          <input
            id={`new-list-${bookId}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("Nueva lista: «Mi top de otoño»")}
            maxLength={60}
            required
          />
          <button type="submit" className="secondary-button small" disabled={pending}>
            <FolderPlus size={14} /> {t("Crear")}
          </button>
        </form>

        {feedback && (
          <p className="action-feedback" role="status">
            {feedback}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
