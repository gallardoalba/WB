"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { ImagePlus, Trash2 } from "lucide-react";
import { MAX_SOURCE_BYTES } from "@/lib/cover-image";
import { useI18n } from "./i18n-provider";

/**
 * Elegir la portada antes de publicar.
 *
 * No sube nada: el formulario guarda el archivo y lo envía cuando la obra ya
 * existe, porque antes de publicar no hay `bookId` al que asociarlo. El
 * servidor acepta JPG y PNG (el PNG se convierte a JPG al guardarlo); el filtro
 * de aquí existe para decirlo en el momento y no después de rellenar todo el
 * formulario.
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
    // Una foto de móvil puede pesar 10 MB: no se rechaza, se reduce al subirla.
    if (chosen.size > MAX_SOURCE_BYTES) {
      setError(t("La imagen es demasiado grande para procesarla (máximo 25 MB)."));
      onChange(null);
      return;
    }
    // El tipo declarado a veces viene vacío: el nombre del archivo lo resuelve.
    if (!/^image\/(jpeg|png)$/.test(chosen.type) && !/\.(jpe?g|png)$/i.test(chosen.name)) {
      setError(t("La portada tiene que ser un archivo JPG o PNG."));
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
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
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
          aria-describedby="offer-cover-hint"
        >
          <ImagePlus size={14} /> {t("Añadir portada (JPG o PNG)")}
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <small className="form-hint" id="offer-cover-hint">
        {t(
          "Obligatorio: es la cara del libro en el catálogo. JPG o PNG; si la imagen es muy grande, se reduce sola.",
        )}
      </small>
    </div>
  );
}
