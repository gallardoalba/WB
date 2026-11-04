"use client";

import { useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

export function BookWantButton({
  bookId,
  initialWanted,
  initialCount,
}: {
  bookId: string;
  initialWanted: boolean;
  initialCount: number;
}) {
  const { t } = useI18n();
  const [wanted, setWanted] = useState(initialWanted);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ wanted: boolean; count: number }>(
        `/api/books/${bookId}/want`,
        { method: "POST", body: { enabled: !wanted } },
      );
      setWanted(result.wanted);
      setCount(result.count);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("No se pudo guardar el aviso."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="book-want">
      <button
        type="button"
        className={wanted ? "secondary-button small book-want-on" : "secondary-button small"}
        aria-pressed={wanted}
        disabled={busy}
        onClick={toggle}
      >
        {wanted ? <BellRing size={15} aria-hidden /> : <Bell size={15} aria-hidden />}
        {wanted ? t("Te avisaremos de nuevos ejemplares") : t("Avísame de nuevos ejemplares")}
      </button>
      {count > 0 && (
        <small>
          {count === 1
            ? t("1 persona lo busca en tu ciudad")
            : t("{n} personas lo buscan en tu ciudad", { n: count })}
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
