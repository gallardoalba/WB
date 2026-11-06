"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { ImagePlus, Trash2 } from "lucide-react";
import { useI18n } from "./i18n-provider";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Elegir la portada antes de publicar.
 *
 * No sube nada: el formulario guarda el archivo y lo envía cuando la obra ya
 * existe, porque antes de publicar no hay `bookId` al que asociarlo. El
 * servidor solo acepta JPG; el filtro de aquí existe para decirlo en el momento
 * y no después de rellenar todo el formulario.
 */
export function CoverFilePicker({
  file,
  onChange,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  // El `blob:` se deriva del archivo, no de un estado que se rellena en un
  // efecto: así no hay renders en cascada y el mismo archivo da la misma URL.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);

  useEffect(() => {
    if (!preview) return;
    // Se libera al cambiar de archivo o al desmontar.
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    // El mismo `input` debe poder elegir otra vez el mismo archivo.
    event.target.value = "";
    if (!chosen) return;

    setError("");
    if (chosen.size > MAX_BYTES) {
      setError(t("La imagen pesa demasiado (máximo 4 MB)."));
      onChange(null);
      return;
    }
    // El tipo declarado a veces viene vacío: el nombre del archivo lo resuelve.
    if (chosen.type !== "image/jpeg" && !/\.jpe?g$/i.test(chosen.name)) {
      setError(t("La portada tiene que ser un archivo JPG."));
      onChange(null);
      return;
    }
    onChange(chosen);
  }

  return (
    <div className="cover-picker">
      <input
        ref={inputRef}
        id="offer-cover"
        type="file"
        accept="image/jpeg,.jpg,.jpeg"
        className="sr-only"
        onChange={choose}
        tabIndex={-1}
        aria-hidden="true"
      />
      {preview ? (
        <div className="cover-picker-preview">
          <Image src={preview} alt="" width={56} height={80} unoptimized />
          <div>
            <p className="form-hint cover-picker-name">{file?.name}</p>
            <button type="button" className="message-report" onClick={() => onChange(null)}>
              <Trash2 size={14} /> {t("Quitar portada")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="secondary-button small"
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus size={14} /> {t("Añadir portada (JPG)")}
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <small className="form-hint">
        {t("Opcional. Sin portada se usa la del ISBN, si existe. Solo JPG, máximo 4 MB.")}
      </small>
    </div>
  );
}
