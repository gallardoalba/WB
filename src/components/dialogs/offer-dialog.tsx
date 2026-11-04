"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen } from "lucide-react";
import { Dialog } from "../dialog";
import { api } from "@/lib/client-api";
import { CATEGORIES, CONDITIONS, TAGS, BOOK_LANGUAGES } from "@/lib/domain";
import { CityField } from "../city-field";
import { IsbnScanner } from "../isbn-scanner";
import { useI18n } from "../i18n-provider";
import type { BaseDialogProps } from "./shared";

export function OfferDialog({
  open,
  onClose,
  onCreated,
  defaultCity,
}: BaseDialogProps & { onCreated: (demand: number) => void; defaultCity: string }) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const isbnRef = useRef<HTMLInputElement>(null);

  function close() {
    setError("");
    setPending(false);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const result = await api<{ demand: number }>("/api/listings", {
        method: "POST",
        body: {
          title: form.get("title"),
          author: form.get("author"),
          category: form.get("category"),
          language: form.get("language"),
          condition: form.get("condition"),
          isbn: form.get("isbn") || undefined,
          city: form.get("city"),
          tags: form.getAll("tags").map(String),
        },
      });
      onCreated(result.demand);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo publicar el libro."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title={t("Comparte un libro")}
      description={t("Cuéntale a la comunidad qué historia estás listo para pasar.")}
      overline={t("HAZ QUE SIGA VIAJANDO")}
      icon={<BookOpen size={20} />}
    >
      <form className="listing-form" onSubmit={submit}>
        <label>
          {t("Título")}
          <input name="title" required maxLength={120} placeholder={t("Ej. El guardián entre el centeno")} />
        </label>
        <label>
          {t("Autor/a")}
          <input name="author" required maxLength={90} placeholder={t("Nombre del autor o autora")} />
        </label>
        <div className="isbn-field">
          <label htmlFor="offer-isbn">
            ISBN <span className="label-optional">{t("(opcional, mejora la portada)")}</span>
          </label>
          <input
            ref={isbnRef}
            id="offer-isbn"
            name="isbn"
            inputMode="numeric"
            placeholder="978…"
            maxLength={17}
          />
          <IsbnScanner
            onDetected={(isbn) => {
              if (isbnRef.current) isbnRef.current.value = isbn;
            }}
          />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="offer-category">{t("Género")}</label>
            <select id="offer-category" name="category" defaultValue={CATEGORIES[0]}>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(category)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="offer-condition">{t("Estado")}</label>
            <select id="offer-condition" name="condition" defaultValue={CONDITIONS[0]}>
              {CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {t(condition)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label>
          {t("Idioma del libro")}
          <select name="language" defaultValue={BOOK_LANGUAGES[0]}>
            {BOOK_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t(language)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Ciudad")}
          <CityField name="city" defaultValue={defaultCity} required />
        </label>

        <fieldset className="tag-field">
          <legend>{t("Etiquetas (hasta 3, opcional)")}</legend>
          <div className="tag-options">
            {TAGS.map((tag) => (
              <label key={tag} className="tag-option">
                <input type="checkbox" name="tags" value={tag} /> {t(tag)}
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button className="share-button form-submit" type="submit" disabled={pending}>
          {pending ? t("Publicando…") : t("Publicar libro")}
          {!pending && <ArrowRight size={16} />}
        </button>
        <small>{t("Al publicar, confirmas que tienes derecho a compartir este ejemplar físico.")}</small>
      </form>
    </Dialog>
  );
}

