"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error("[app] error no controlado", error);
  }, [error]);

  return (
    <main className="app-shell loading-shell">
      <div className="error-card" role="alert">
        <span className="dialog-icon">
          <AlertTriangle size={20} />
        </span>
        <h1>{t("Algo no ha ido bien")}</h1>
        <p>
          {t("No pudimos cargar esta página. Puedes intentarlo de nuevo; si el problema continúa, vuelve al catálogo en unos minutos.")}
        </p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={reset}>
            {t("Reintentar")}
          </button>
          <Link className="share-button" href="/">
            {t("Ir al catálogo")}
          </Link>
        </div>
      </div>
    </main>
  );
}
