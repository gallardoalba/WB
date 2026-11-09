import type { Metadata } from "next";
import { TurnstileBridge } from "@/components/turnstile-bridge";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";

export const instant = false;

/**
 * Página de servicio para la app Android.
 *
 * Cloudflare Turnstile valida el dominio de la página que incrusta el widget, y
 * un `WebView` con contenido local no tiene dominio. Por eso la app abre esta
 * página del propio servidor y recibe el token por una interfaz JavaScript.
 *
 * No se indexa ni se enlaza desde ningún sitio: quien llegue desde el navegador
 * tiene el registro normal en la portada.
 */
export const metadata: Metadata = {
  title: "Verificación humana",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const locale = await getLocale();
  const t = (text: string) => translate(locale, text);
  return (
    <main className="app-shell loading-shell">
      <div className="error-card">
        <h1>{t("Verificación humana")}</h1>
        <p>
          {t(
            "Esta página la usa la aplicación para Android al crear una cuenta. Si has llegado desde el navegador, ve al registro desde la portada.",
          )}
        </p>
        <TurnstileBridge />
      </div>
    </main>
  );
}
