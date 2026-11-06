"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { prepareCover, MAX_SOURCE_BYTES } from "@/lib/cover-image";
import { useI18n } from "./i18n-provider";

/**
 * Subir la portada de una obra.
 *
 * Muchos ISBN —sobre todo ediciones alemanas— no están en los servicios de
 * portadas, así que quien publica el ejemplar puede subir una foto. La imagen
 * se envía en crudo (`PUT` con `image/*`), el servidor comprueba el tipo por los
 * primeros bytes y la guarda para la obra entera: todas las copias del mismo
 * libro la enseñan.
 */
export function BookCoverUpload({
  bookId,
  hasUploaded,
}: {
  bookId: string;
  /** Ya hay una portada subida (se puede quitar y volver a la del ISBN). */
  hasUploaded: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // El mismo `input` debe poder elegir otra vez el mismo archivo.
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(t("La portada tiene que ser un archivo JPG."));
      return;
    }
    if (file.type !== "image/jpeg" && !/\.jpe?g$/i.test(file.name)) {
      setError(t("La portada tiene que ser un archivo JPG."));
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError(t("La imagen es demasiado grande para procesarla (máximo 25 MB)."));
      return;
    }

    setBusy(true);
    setError("");
    setFeedback("");
    try {
      // La foto se reduce en el navegador: el servidor solo acepta JPG de 4 MB.
      // Si no se puede decodificar aquí, se intenta con el original.
      let body: Blob = file;
      try {
        body = await prepareCover(file);
      } catch {
        body = file;
      }
      const response = await fetch(`/api/cover/book/${bookId}`, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        // Con el código a la vista, un 413 del proxy (cuerpo demasiado grande)
        // deja de parecer un fallo genérico de la aplicación.
        throw new Error(
          payload?.error ?? `${t("No se pudo subir la portada.")} (HTTP ${response.status})`,
        );
      }
      setFeedback(t("Portada actualizada."));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo subir la portada."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const response = await fetch(`/api/cover/book/${bookId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? t("No se pudo quitar la portada."));
      }
      setFeedback(t("Portada retirada."));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo quitar la portada."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cover-upload">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,.jpg,.jpeg"
        className="sr-only"
        onChange={upload}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        className="message-report"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus size={14} /> {busy ? t("Subiendo…") : hasUploaded ? t("Cambiar portada") : t("Subir portada")}
      </button>
      {hasUploaded && (
        <button type="button" className="message-report" disabled={busy} onClick={() => void remove()}>
          <Trash2 size={14} /> {t("Quitar portada")}
        </button>
      )}
      <p className="cover-upload-hint">
        {t(
          "Si nadie tiene la portada, sube una foto tuya en JPG; si es muy grande, se reduce sola.",
        )}
      </p>
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
  );
}
