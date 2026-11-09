"use client";

import { catchError, type ErrorInfo } from "next/error";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "./i18n-provider";

/**
 * Frontera de errores por sección.
 *
 * `app/error.tsx` protege la ruta entera: si una pieza de cliente falla —el
 * foro del club, los comentarios, el diálogo de mensajes, los botones de una
 * lista— se lleva por delante la página y, con ella, lo que la persona estaba
 * escribiendo. Esta frontera deja el daño dentro de su sección y ofrece
 * «Reintentar», que vuelve a renderizar sin recargar y conserva el estado de
 * todo lo que queda fuera.
 *
 * Se construye con `catchError` de Next y no con una clase propia porque así
 * `redirect()` y `notFound()` —que por dentro son errores lanzados— siguen
 * funcionando y el aviso se limpia solo al cambiar de ruta.
 */
export const SectionBoundary = catchError(function SectionFallback(
  _props: Record<string, unknown>,
  { retry }: ErrorInfo,
) {
  const { t } = useI18n();
  return (
    <div className="section-error" role="alert">
      <AlertTriangle size={16} aria-hidden />
      <p>{t("Algo no ha ido bien")}</p>
      <button type="button" className="secondary-button small" onClick={() => retry()}>
        {t("Reintentar")}
      </button>
    </div>
  );
});
