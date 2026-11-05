"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MapPin } from "lucide-react";
import { CITIES, findCity } from "@/lib/cities";
import { normalizeText } from "@/lib/text";
import { useI18n } from "./i18n-provider";

/**
 * Campo de ciudad con búsqueda.
 *
 * Antes usaba `<input list>` + `<datalist>`: el navegador solo sugiere cuando
 * se teclea un **prefijo** exacto (escribir «Breisgau» no encontraba «Freiburg
 * im Breisgau»), no se abre al enfocar y en móvil se comporta distinto en cada
 * navegador. Con un catálogo de más de cien ciudades la selección
 * parecía rota.
 *
 * Ahora es un combobox con lista propia: filtra por cualquier parte del nombre,
 * ignora acentos y mayúsculas, se abre al enfocar y se maneja con teclado
 * (flechas, Intro, Escape) o con el ratón.
 */
const MAX_SUGGESTIONS = 8;

export function CityField({
  name,
  id,
  defaultValue = "",
  required = true,
  ariaInvalid,
  ariaDescribedBy,
  onChange,
}: {
  name: string;
  id?: string;
  defaultValue?: string;
  required?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  onChange?: (value: string) => void;
}) {
  const { t } = useI18n();
  const autoId = useId();
  const inputId = id ?? `${autoId}-city`;
  const listId = `${autoId}-city-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Con una ciudad ya elegida se muestran todas para poder cambiarla; mientras
  // se escribe, se filtra por cualquier coincidencia.
  const matches = useMemo(() => {
    const exact = findCity(value);
    const query = exact && exact.name === value ? "" : normalizeText(value);
    const pool = query
      ? CITIES.filter((city) => normalizeText(city.name).includes(query))
      : CITIES;
    return pool.slice(0, MAX_SUGGESTIONS);
  }, [value]);

  useEffect(() => {
    // El campo puede quedar al final de un diálogo alto: sin esto la lista se
    // abre por debajo del borde visible y parece que no hay sugerencias.
    if (!open) return;
    listRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  function choose(cityName: string) {
    setValue(cityName);
    onChange?.(cityName);
    setOpen(false);
    inputRef.current?.focus();
  }

  /** Guarda el nombre canónico de la ciudad al salir del campo. */
  function commit() {
    setOpen(false);
    const canonical = findCity(value);
    if (canonical && canonical.name !== value) {
      setValue(canonical.name);
      onChange?.(canonical.name);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (open ? (current + 1) % matches.length : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (open ? (current - 1 + matches.length) % matches.length : 0));
      return;
    }
    if (event.key === "Enter" && open && matches[active]) {
      // Sin esto, Intro enviaría el formulario en vez de elegir la sugerencia.
      event.preventDefault();
      choose(matches[active]!.name);
      return;
    }
    if (event.key === "Escape") setOpen(false);
  }

  const activeOption = open ? matches[active] : undefined;

  return (
    <div className="city-field">
      <div className="city-input-wrap">
        <MapPin size={15} className="city-input-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          value={value}
          required={required}
          maxLength={80}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={t("Busca tu ciudad")}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${listId}-${active}` : undefined}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setActive(0);
            onChange?.(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      </div>

      {open && (
        <ul className="city-list" id={listId} ref={listRef} role="listbox" aria-label={t("Ciudades")}>
          {matches.length === 0 && (
            <li className="city-list-empty" role="presentation">
              {t("Ninguna ciudad coincide. Revisa cómo se escribe.")}
            </li>
          )}
          {matches.map((city, index) => (
            <li
              key={city.name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Sin `preventDefault` el input perdería el foco antes del clic.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(city.name)}
              onMouseEnter={() => setActive(index)}
            >
              {city.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

