"use client";

import { useState } from "react";
import { BookOpen, Check } from "lucide-react";
import type { ReadingStatus } from "@/lib/domain";
import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

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
  const [status, setStatus] = useState<ReadingStatus | null>(initialStatus);
  const [counts, setCounts] = useState({ reading: initialReading, read: initialRead });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function update(next: ReadingStatus | null) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ status: ReadingStatus | null; reading: number; read: number }>(
        `/api/books/${bookId}/reading-state`,
        { method: "POST", body: { status: next } },
      );
      setStatus(result.status);
      setCounts({ reading: result.reading, read: result.read });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo guardar tu lectura."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reading-state">
      <span>{t("Tu lectura")}</span>
      <button
        type="button"
        className={status === "reading" ? "filter-chip selected" : "filter-chip"}
        aria-pressed={status === "reading"}
        disabled={busy}
        onClick={() => void update(status === "reading" ? null : "reading")}
      >
        <BookOpen size={14} aria-hidden /> {t("Leyendo")}
      </button>
      <button
        type="button"
        className={status === "read" ? "filter-chip selected" : "filter-chip"}
        aria-pressed={status === "read"}
        disabled={busy}
        onClick={() => void update(status === "read" ? null : "read")}
      >
        <Check size={14} aria-hidden /> {t("Leído")}
      </button>
      {(counts.reading > 0 || counts.read > 0) && (
        <small>
          {counts.reading > 0 &&
            (counts.reading === 1
              ? t("1 persona lo está leyendo")
              : t("{n} personas lo están leyendo", { n: counts.reading }))}
          {counts.reading > 0 && counts.read > 0 && " · "}
          {counts.read > 0 &&
            (counts.read === 1
              ? t("1 persona lo ha leído")
              : t("{n} personas lo han leído", { n: counts.read }))}
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
