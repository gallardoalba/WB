"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MapPin } from "lucide-react";
import type { CitySuggestion } from "@/lib/city-search";
import { useI18n } from "./i18n-provider";

/** Lo que se espera antes de preguntar: media docena de teclas por minuto. */
const DEBOUNCE_MS = 220;
/** Por debajo de dos letras no hay lista que enseñar. */
const MIN_CHARS = 2;

/**
 * Campo de ciudad: se elige de una lista.
 *
 * Se escribe y aparece una lista de municipios de Alemania y Austria que sale de
 * OpenStreetMap (ver `city-search.ts`); al elegir uno se guarda su nombre tal y
 * como lo conoce el mapa. No se impide escribir a mano: quien teclea una
 * ciudad que la lista no trae (o la escribe antes de que llegue) puede enviar
 * el formulario igual, y es el servidor quien comprueba el nombre al guardar.
 *
 * Se comporta como un `combobox`: flechas para recorrer, Intro para elegir,
 * Escape para cerrar y el foco siempre en el campo.
 */
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
  const listId = `${inputId}-list`;

  const [value, setValue] = useState(defaultValue);
  const [options, setOptions] = useState<CitySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  // Nombre elegido en la lista: por él no se vuelve a preguntar.
  const picked = useRef(defaultValue.trim());
  // Un formulario dentro de un diálogo deja poco sitio: la lista se abre hacia
  // arriba y se recorta si abajo no cabe.
  const wrap = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ side: "below" | "above"; maxHeight: number }>({
    side: "below",
    maxHeight: 232,
  });

  function makeRoom() {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    const below = window.innerHeight - box.bottom - 16;
    const above = box.top - 16;
    const side = below < 180 && above > below ? "above" : "below";
    setPlace({ side, maxHeight: Math.max(120, Math.min(232, side === "above" ? above : below)) });
  }

  useEffect(() => {
    const query = value.trim();
    // Nada que buscar, o es justo lo que se acaba de elegir.
    if (query.length < MIN_CHARS || query === picked.current) return;

    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/cities?q=${encodeURIComponent(query)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { cities?: unknown } | null) => {
          if (!alive) return;
          setOptions(Array.isArray(payload?.cities) ? (payload.cities as CitySuggestion[]) : []);
          setActive(-1);
          makeRoom();
          setOpen(true);
        })
        .catch(() => {
          if (!alive) return;
          setOptions([]);
          setOpen(false);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [value]);

  function choose(option: CitySuggestion) {
    picked.current = option.name;
    setValue(option.name);
    setOptions([]);
    setOpen(false);
    setActive(-1);
    onChange?.(option.name);
  }

  function type(next: string) {
    // Se vuelve a escribir después de elegir: la lista manda otra vez.
    picked.current = "";
    setValue(next);
    setActive(-1);
    if (next.trim().length < MIN_CHARS) {
      setOptions([]);
      setOpen(false);
    }
    onChange?.(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        const next = current + step;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      // Elegir no envía el formulario: el segundo Intro ya se lo deja.
      event.preventDefault();
      choose(options[active >= 0 ? active : 0]!);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div
      ref={wrap}
      className="city-field"
      onBlur={(event) => {
        // Si el foco se va fuera del campo, la lista se cierra.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="city-input-wrap">
        <MapPin size={15} className="city-input-icon" aria-hidden="true" />
        <input
          id={inputId}
          name={name}
          value={value}
          required={required}
          minLength={MIN_CHARS}
          maxLength={80}
          // El desplegable del navegador taparía las sugerencias del mapa.
          autoComplete="off"
          enterKeyHint="done"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={t("Tu ciudad")}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          onChange={(event) => type(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <div className={place.side === "above" ? "city-suggestions is-above" : "city-suggestions"}>
          {options.length > 0 ? (
            <ul
              className="city-options"
              role="listbox"
              id={listId}
              aria-label={t("Sugerencias de ciudad")}
              style={{ maxHeight: place.maxHeight }}
            >
              {options.map((option, index) => (
                <li
                  key={`${option.name}-${index}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={index === active ? "city-option is-active" : "city-option"}
                  // `mousedown` y no `click`: al pulsar no se pierde el foco del campo.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onMouseMove={() => setActive(index)}
                >
                  <span className="city-option-name">{option.name}</span>
                  {option.region && <span className="city-option-region">{option.region}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="city-options-note" role="status">
              {loading ? t("Buscando ciudades…") : t("No encontramos esa ciudad.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
