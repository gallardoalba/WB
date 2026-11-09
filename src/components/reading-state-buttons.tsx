"use client";

import { useOptimistic, useState, useTransition } from "react";
import { BookOpen, Check } from "lucide-react";
import type { ReadingStatus } from "@/lib/domain";
import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

/**
 * «Leyendo» / «Leído». Igual que el aviso de nuevos ejemplares: el estado y el
 * contador cambian al pulsar y se deshacen solos si la petición falla. La base
 * es lo que confirmó el servidor, así que al cerrar la transición el número
 * bueno (que puede haber cambiado con otra persona) sustituye al estimado.
 */
export function ReadingStateButtons({
  bookId,
  initialStatus,
  initialReading,
  initialRead,
}: {
  bookId: string;
  initialStatus: ReadingStatus | null;
  initialReading: number;
  initialRead: number;
}) {
  const { t } = useI18n();
  const [servidor, setServidor] = useState({
    status: initialStatus,
    reading: initialReading,
    read: initialRead,
  });
  const [estado, aplicar] = useOptimistic(
    servidor,
    (actual, siguiente: ReadingStatus | null) => {
      const cuenta = (estado: ReadingStatus | null, delta: number) => (
        estado === "reading" ? { reading: Math.max(0, actual.reading + delta) } :
        estado === "read" ? { read: Math.max(0, actual.read + delta) } : {}
      );
      return {
        status: siguiente,
        reading: actual.reading,
        read: actual.read,
        ...cuenta(siguiente, 1),
        ...cuenta(actual.status, -1),
      };
    },
  );
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");

  function update(next: ReadingStatus | null) {
    setError("");
    iniciar(async () => {
      aplicar(next);
      try {
        const result = await api<{ status: ReadingStatus | null; reading: number; read: number }>(
          `/api/books/${bookId}/reading-state`,
          { method: "POST", body: { status: next } },
        );
        setServidor({ status: result.status, reading: result.reading, read: result.read });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("No se pudo guardar tu lectura."));
      }
    });
  }

  return (
    <div className="reading-state">
      <span>{t("Tu lectura")}</span>
      <button
        type="button"
        className={estado.status === "reading" ? "filter-chip selected" : "filter-chip"}
        aria-pressed={estado.status === "reading"}
        aria-busy={pendiente || undefined}
        disabled={pendiente}
        onClick={() => update(estado.status === "reading" ? null : "reading")}
      >
        <BookOpen size={14} aria-hidden /> {t("Leyendo")}
      </button>
      <button
        type="button"
        className={estado.status === "read" ? "filter-chip selected" : "filter-chip"}
        aria-pressed={estado.status === "read"}
        aria-busy={pendiente || undefined}
        disabled={pendiente}
        onClick={() => update(estado.status === "read" ? null : "read")}
      >
        <Check size={14} aria-hidden /> {t("Leído")}
      </button>
      {(estado.reading > 0 || estado.read > 0) && (
        <small>
          {estado.reading > 0 &&
            (estado.reading === 1
              ? t("1 persona lo está leyendo")
              : t("{n} personas lo están leyendo", { n: estado.reading }))}
          {estado.reading > 0 && estado.read > 0 && " · "}
          {estado.read > 0 &&
            (estado.read === 1
              ? t("1 persona lo ha leído")
              : t("{n} personas lo han leído", { n: estado.read }))}
        </small>
      )}
      {error && (
        <small className="form-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
