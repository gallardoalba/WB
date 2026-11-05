"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

type Book = { id: string; title: string; author: string };

/**
 * Buscador de obras del catálogo.
 *
 * Un club de lectura no tiene por qué elegir solo entre los libros que su
 * fundador tiene publicados: cualquier obra del catálogo vale como lectura (la
 * conversación y los ejemplares cuelgan de la obra). Se busca por título o
 * autoría y se elige de la lista.
 *
 * La espera entre teclas vive en el propio manejador: así no hay `setState`
 * dentro de un efecto y la lista se limpia en cuanto se borra el texto.
 */
export function BookPicker({
  onSelect,
  placeholder,
}: {
  onSelect: (book: Book) => void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Book[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  function cambiar(valor: string) {
    setTexto(valor);
    if (temporizador.current) clearTimeout(temporizador.current);
    const consulta = valor.trim();
    if (consulta.length < 2) {
      setResultados([]);
      setBuscando(false);
      setError("");
      return;
    }
    setBuscando(true);
    temporizador.current = setTimeout(() => {
      void (async () => {
        try {
          const data = await api<{ books: Book[] }>(`/api/books?q=${encodeURIComponent(consulta)}`);
          setResultados(data.books);
          setError("");
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : t("No se pudo buscar."));
        } finally {
          setBuscando(false);
        }
      })();
    }, 280);
  }

  return (
    <div className="book-picker">
      <label className="book-picker-field">
        <Search size={14} aria-hidden />
        <span className="sr-only">{t("Buscar un libro del catálogo")}</span>
        <input
          type="search"
          value={texto}
          onChange={(event) => cambiar(event.target.value)}
          placeholder={placeholder ?? t("Busca por título o autoría")}
          autoComplete="off"
        />
      </label>
      {buscando && <p className="empty-note">{t("Buscando…")}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!buscando && texto.trim().length >= 2 && resultados.length === 0 && !error && (
        <p className="empty-note">{t("Ningún libro con ese título o esa autoría.")}</p>
      )}
      {resultados.length > 0 && (
        <ul className="book-picker-list">
          {resultados.map((book) => (
            <li key={book.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(book);
                  cambiar("");
                }}
              >
                <strong>{book.title}</strong>
                <small>{book.author}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
