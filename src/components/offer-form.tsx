"use client";

import { useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/client-api";
import { CATEGORIES, CONDITIONS, BOOK_LANGUAGES, tagsForCategory } from "@/lib/domain";
import { coverFromIsbn, isValidIsbn, normalizeIsbn } from "@/lib/text";
import { CityField } from "./city-field";
import { CoverFilePicker } from "./cover-file-picker";
import { useI18n } from "./i18n-provider";

const MAX_TAGS = 3;

/**
 * Sube la portada de una obra recién creada. El cuerpo va en crudo con
 * `image/jpeg`; el servidor comprueba los primeros bytes, no lo declarado.
 */
async function uploadCover(bookId: string, file: File): Promise<boolean> {
  try {
    const response = await fetch(`/api/cover/book/${bookId}`, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: file,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Ficha que ya existe en el catálogo con ese ISBN exacto. */
type KnownBook = { id: string; title: string; author: string; category: string };

/** Otra edición (otro ISBN) del mismo libro que ya está en el catálogo. */
type OtherEdition = { id: string; title: string; author: string; isbn: string | null };

type Metadata = {
  title: string;
  authors: string[];
  language: string | null;
  category: string | null;
  tags: string[];
  publisher: string | null;
  year: string | null;
  source: "dnb" | "openlibrary" | "dnb+openlibrary";
};

type Lookup = {
  book: KnownBook | null;
  metadata: Metadata | null;
  editions: OtherEdition[];
};

/**
 * Formulario de «Ofrecer un libro».
 *
 * Era el contenido de una ventana emergente (`OfferDialog`). Ahora se pinta en
 * su propia página (`/ofrecer`), así que no recibe `open`/`onClose`: al
 * publicar avisa con `onCreated` y quien lo usa decide a dónde seguir.
 */
export function OfferForm({
  onCreated,
  defaultCity,
}: {
  onCreated: (demand: number) => void;
  defaultCity: string;
}) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [language, setLanguage] = useState<string>(BOOK_LANGUAGES[0]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [scan, setScan] = useState("");
  // Si no hay portada para ese ISBN no se enseña un icono roto.
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  const [knownBook, setKnownBook] = useState<KnownBook | null>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [editions, setEditions] = useState<OtherEdition[]>([]);
  const [looking, setLooking] = useState(false);
  const [missing, setMissing] = useState(false);
  // Libros sin ISBN (antiguos, de autor, folletos): el campo se reserva y la
  // ficha se escribe a mano, sin datos de ningún catálogo.
  const [noIsbn, setNoIsbn] = useState(false);
  // Portada elegida a mano. Se sube después de crear la obra: antes no hay
  // `bookId` al que asociarla.
  const [cover, setCover] = useState<File | null>(null);
  // Si la obra se creó pero la portada no subió, se queda el id para no enviar
  // el formulario otra vez (crearía un ejemplar duplicado) y poder enlazarlo.
  const [createdListingId, setCreatedListingId] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const authorRef = useRef<HTMLInputElement>(null);
  const lookupSeq = useRef(0);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const availableTags = tagsForCategory(category);
  const typedIsbn = normalizeIsbn(scan);
  // Con un ISBN válido se enseña la portada antes de publicar.
  const coverPreview = typedIsbn && isValidIsbn(typedIsbn) ? coverFromIsbn(typedIsbn) : null;
  // El título y la autoría los pone el ISBN. Solo se escriben a mano cuando
  // ningún catálogo conoce la edición (autoeditados, ediciones antiguas…).
  const manual = noIsbn || (missing && !knownBook && !metadata);
  // Cuando el dato viene del ISBN, el desplegable se lee como un dato fijo.
  const autoCategory = Boolean(knownBook?.category ?? metadata?.category);
  const autoLanguage = Boolean(knownBook ?? metadata?.language);

  /** Al cambiar de género se dejan solo las etiquetas que ese género propone. */
  function changeCategory(next: string, tags?: string[]) {
    setCategory(next);
    const allowed = tagsForCategory(next);
    const proposed = (tags ?? selectedTags).filter((tag) => allowed.includes(tag as never));
    setSelectedTags(proposed.slice(0, MAX_TAGS));
  }

  function toggleTag(tag: string) {
    setSelectedTags((current) => {
      if (current.includes(tag)) return current.filter((value) => value !== tag);
      if (current.length >= MAX_TAGS) return current;
      return [...current, tag];
    });
  }

  /**
   * Rellena el formulario con lo que dice el ISBN: título, autoría, idioma,
   * género y etiquetas. Lo que no venga en los datos se queda como está para
   * que solo haya que elegir el estado y la ciudad.
   */
  function fill(values: {
    title: string;
    author: string;
    category: string;
    language?: string | null;
    tags?: string[];
  }) {
    if (titleRef.current) titleRef.current.value = values.title;
    if (authorRef.current) authorRef.current.value = values.author;
    setCategory(values.category);
    if (values.language) setLanguage(values.language);
    const allowed = tagsForCategory(values.category);
    setSelectedTags((values.tags ?? []).filter((tag) => allowed.includes(tag as never)).slice(0, MAX_TAGS));
  }

  function resetFields() {
    if (titleRef.current) titleRef.current.value = "";
    if (authorRef.current) authorRef.current.value = "";
    setCategory(CATEGORIES[0]);
    setLanguage(BOOK_LANGUAGES[0]);
    setSelectedTags([]);
  }

  /**
   * Marca que el ejemplar no tiene ISBN: se reserva el campo (queda vacío y
   * deshabilitado) y el título y la autoría pasan a escribirse a mano. Lo que
   * ya estuviera escrito se conserva: si alguien se da cuenta a mitad de
   * escribir, no pierde la ficha.
   */
  function toggleNoIsbn(checked: boolean) {
    setNoIsbn(checked);
    if (!checked) {
      resetFields();
      return;
    }
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    // Sin esto, una consulta en vuelo repintaría la ficha con datos del ISBN
    // que la persona acaba de descartar.
    lookupSeq.current += 1;
    setScan("");
    setKnownBook(null);
    setMetadata(null);
    setEditions([]);
    setMissing(false);
    setLooking(false);
    setError("");
  }

  function onIsbnChange(value: string) {
    setScan(value);
    const normalized = normalizeIsbn(value);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    lookupSeq.current += 1;
    setKnownBook(null);
    setMetadata(null);
    setEditions([]);
    setMissing(false);
    setError("");
    if (!normalized || !isValidIsbn(normalized)) {
      setLooking(false);
      resetFields();
      return;
    }
    const seq = lookupSeq.current;
    setLooking(true);
    lookupTimer.current = setTimeout(async () => {
      try {
        const found = await api<Lookup>(`/api/isbn/${normalized}`);
        if (seq !== lookupSeq.current) return;
        setKnownBook(found.book);
        setMetadata(found.metadata);
        setEditions(found.editions);
        setMissing(!found.book && !found.metadata);
        if (found.book) {
          fill({
            title: found.book.title,
            author: found.book.author,
            category: found.book.category,
          });
        } else if (found.metadata) {
          fill({
            title: found.metadata.title,
            author: found.metadata.authors.join(", "),
            category: found.metadata.category ?? CATEGORIES[0],
            language: found.metadata.language,
            tags: found.metadata.tags,
          });
        }
      } catch {
        // Si la consulta falla, se puede escribir a mano: no se bloquea.
        if (seq === lookupSeq.current) setMissing(true);
      } finally {
        if (seq === lookupSeq.current) setLooking(false);
      }
    }, 350);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const result = await api<{ listing: { id: string; bookId: string }; demand: number }>(
        "/api/listings",
        {
          method: "POST",
          body: {
            title: form.get("title"),
            author: form.get("author"),
            // Género e idioma salen del estado: cuando los pone el ISBN el
            // desplegable está deshabilitado y `FormData` no los incluiría.
            category,
            language,
            condition: form.get("condition"),
            isbn: noIsbn ? undefined : form.get("isbn") || undefined,
            city: form.get("city"),
            tags: form.getAll("tags").map(String),
          },
        },
      );

      if (cover) {
        const uploaded = await uploadCover(result.listing.bookId, cover);
        if (!uploaded) {
          setCreatedListingId(result.listing.id);
          setError(
            t(
              "El libro ya está publicado, pero la portada no se pudo subir. Puedes añadirla desde su ficha.",
            ),
          );
          return;
        }
      }

      onCreated(result.demand);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo publicar el libro."));
    } finally {
      setPending(false);
    }
  }

  const sourceLabel =
    metadata?.source === "dnb"
      ? t("Datos de la Biblioteca Nacional Alemana (DNB).")
      : metadata?.source === "openlibrary"
        ? t("Datos de Open Library.")
        : t("Datos de la DNB y Open Library.");

  return (
      <form className="listing-form offer-form" onSubmit={submit}>
        <div className="offer-grid">
        <section className="offer-block">
          <h2 className="offer-block-title">{t("El libro")}</h2>
        <div className="isbn-field">
          <label htmlFor="offer-isbn">{t("ISBN")}</label>
          <div className="isbn-input-row">
            <input
              id="offer-isbn"
              name="isbn"
              required={!noIsbn}
              disabled={noIsbn}
              inputMode="numeric"
              placeholder="978…"
              maxLength={17}
              value={scan}
              aria-describedby="offer-isbn-hint"
              onChange={(event) => onIsbnChange(event.target.value)}
            />
            {coverPreview && failedPreview !== coverPreview && (
              // Vista previa de la portada que se servirá desde la app.
              <Image
                className="isbn-preview"
                src={coverPreview}
                alt=""
                aria-hidden="true"
                width={36}
                height={52}
                unoptimized
                onError={() => setFailedPreview(coverPreview)}
              />
            )}
          </div>
          {/* La salida para los libros que no llevan ISBN, justo debajo del
              campo: quien tiene un libro antiguo o un folleto no debe quedarse
              atascado en un campo obligatorio. */}
          <label className="no-isbn-toggle">
            <input
              type="checkbox"
              checked={noIsbn}
              onChange={(event) => toggleNoIsbn(event.target.checked)}
            />
            <span>{t("Este libro no tiene ISBN")}</span>
          </label>
          <small className="form-hint" id="offer-isbn-hint">
            {noIsbn
              ? t(
                  "Los libros antiguos, las ediciones de autor y los folletos no siempre lo llevan. Escribe el título y la autoría a mano: la ficha quedará sin verificar.",
                )
              : t("Obligatorio: está en la contraportada o detrás de la portada.")}
          </small>
          {looking && (
            <p className="form-hint" role="status">
              {t("Buscando el libro por su ISBN…")}
            </p>
          )}
          {knownBook && (
            <p className="form-hint known-book-note" role="status">
              {t("Este ISBN ya está en el catálogo como «{title}» de {author}: tu ejemplar se añade a esa ficha.", {
                title: knownBook.title,
                author: knownBook.author,
              })}
            </p>
          )}
          {!knownBook && editions.length > 0 && (
            <p className="form-hint known-book-note" role="status">
              {t("Ya hay una edición de esta obra en el catálogo ({isbn}): tu ejemplar se agrupará con ella.", {
                isbn: editions[0]!.isbn ?? "—",
              })}{" "}
              <Link href={`/obra/${editions[0]!.id}`} target="_blank">
                {t("Ver la obra")}
              </Link>
            </p>
          )}
          {metadata && (
            <p className="form-hint" role="status">
              {sourceLabel}
              {metadata.publisher ? ` · ${metadata.publisher}` : ""}
              {metadata.year ? ` · ${metadata.year}` : ""}
            </p>
          )}
          {missing && (
            <p className="form-hint isbn-missing" role="status">
              {t(
                "Ningún catálogo tiene datos de este ISBN. Escribe el título y la autoría a mano; quedarán sin verificar.",
              )}
            </p>
          )}
        </div>

        <CoverFilePicker file={cover} onChange={setCover} />

        <div className="form-row">
          <div className="field">
            <label htmlFor="offer-title">{t("Título")}</label>
            <input
              ref={titleRef}
              id="offer-title"
              name="title"
              required
              maxLength={120}
              readOnly={!manual}
              aria-describedby="offer-title-hint"
            />
          </div>
          <div className="field">
            <label htmlFor="offer-author">{t("Autor/a")}</label>
            <input
              ref={authorRef}
              id="offer-author"
              name="author"
              required
              maxLength={90}
              readOnly={!manual}
              placeholder={manual ? t("Nombre del autor o autora") : undefined}
            />
          </div>
        </div>
        <small className="form-hint" id="offer-title-hint">
          {manual
            ? t("Sin datos del ISBN: revisa que el título y la autoría sean correctos.")
            : t("El título y la autoría vienen del ISBN y no se editan.")}
        </small>

        <div className="form-row">
          <div className="field">
            <label htmlFor="offer-category">{t("Género")}</label>
            <select
              id="offer-category"
              name="category"
              value={category}
              className={autoCategory ? "auto-field" : undefined}
              disabled={autoCategory}
              onChange={(event) => changeCategory(event.target.value)}
            >
              {CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {t(option)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="offer-language">{t("Idioma del libro")}</label>
            <select
              id="offer-language"
              name="language"
              value={language}
              className={autoLanguage ? "auto-field" : undefined}
              disabled={autoLanguage}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {BOOK_LANGUAGES.map((option) => (
                <option key={option} value={option}>
                  {t(option)}
                </option>
              ))}
            </select>
          </div>
        </div>
        </section>

        <section className="offer-block">
          <h2 className="offer-block-title">{t("Tu ejemplar")}</h2>

        <div className="form-row">
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
          <div className="field">
            <label htmlFor="offer-city">{t("Ciudad")}</label>
            <CityField id="offer-city" name="city" defaultValue={defaultCity} required />
          </div>
        </div>

        <fieldset className="tag-field">
          <legend>
            {t("Etiquetas (hasta 3, opcional)")}
            <span className="tag-counter" aria-live="polite">
              {" "}
              {selectedTags.length}/{MAX_TAGS}
            </span>
          </legend>
          <div className="tag-options">
            {availableTags.map((tag) => {
              const checked = selectedTags.includes(tag);
              return (
                <label key={tag} className={`tag-option${checked ? " selected" : ""}`}>
                  <input
                    type="checkbox"
                    name="tags"
                    value={tag}
                    checked={checked}
                    onChange={() => toggleTag(tag)}
                    disabled={!checked && selectedTags.length >= MAX_TAGS}
                  />
                  {t(tag)}
                </label>
              );
            })}
          </div>
        </fieldset>

        </section>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {createdListingId && (
          <p className="form-hint">
            <Link href={`/libro/${createdListingId}`}>{t("Ver la ficha del libro")}</Link>
          </p>
        )}

        <div className="offer-actions">
          <small>{t("Al publicar, confirmas que tienes derecho a compartir este ejemplar físico.")}</small>
          <button
            className="share-button form-submit"
            type="submit"
            disabled={pending || Boolean(createdListingId)}
          >
            {pending ? t("Publicando…") : t("Publicar libro")}
            {!pending && <ArrowRight size={16} />}
          </button>
        </div>
      </form>
  );
}
