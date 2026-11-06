"use client";

import { useId, useState } from "react";
import { MapPin } from "lucide-react";
import { useI18n } from "./i18n-provider";

/**
 * Campo de ciudad.
 *
 * Antes era un combobox con las 123 ciudades alemanas: con la plataforma
 * abierta a toda Europa esa lista mentía, porque parecía que solo se podía
 * elegir una de ellas. Ahora es un campo de texto libre —se escribe la ciudad—
 * y el servidor comprueba contra OpenStreetMap que existe, guardando su nombre
 * canónico (así «Munich» y «München» son la misma). Si el geocodificador no
 * responde, se guarda tal cual: un corte de red no impide registrarse.
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
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="city-field">
      <div className="city-input-wrap">
        <MapPin size={15} className="city-input-icon" aria-hidden="true" />
        <input
          id={inputId}
          name={name}
          value={value}
          required={required}
          maxLength={80}
          autoComplete="address-level2"
          enterKeyHint="done"
          placeholder={t("Tu ciudad")}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          onChange={(event) => {
            setValue(event.target.value);
            onChange?.(event.target.value);
          }}
        />
      </div>
    </div>
  );
}
