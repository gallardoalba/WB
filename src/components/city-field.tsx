"use client";

import { useId } from "react";
import { CITIES } from "@/lib/cities";
import { useI18n } from "./i18n-provider";

/**
 * Campo de ciudad con búsqueda nativa (`datalist`): evita un `<select>` de 123
 * opciones y sigue enviando el nombre canónico que valida el servidor.
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
  const listId = `${useId()}-cities`;
  return (
    <>
      <input
        id={id}
        name={name}
        list={listId}
        defaultValue={defaultValue}
        required={required}
        maxLength={80}
        autoComplete="address-level2"
        enterKeyHint="done"
        placeholder={t("Busca tu ciudad")}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      />
      <datalist id={listId}>
        {CITIES.map((city) => (
          <option key={city.name} value={city.name} />
        ))}
      </datalist>
    </>
  );
}
