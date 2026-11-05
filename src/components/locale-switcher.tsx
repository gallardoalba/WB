"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "@/lib/locale";
import { useI18n } from "./i18n-provider";

/** Banderas dibujadas en SVG: no dependen de la fuente de emojis del sistema. */
function FlagES() {
  return (
    <svg className="locale-flag" viewBox="0 0 20 14" aria-hidden="true">
      <rect width="20" height="14" fill="#AA151B" />
      <rect y="3.5" width="20" height="7" fill="#F1BF00" />
    </svg>
  );
}

function FlagDE() {
  return (
    <svg className="locale-flag" viewBox="0 0 20 14" aria-hidden="true">
      <rect width="20" height="14" fill="#000000" />
      <rect y="4.67" width="20" height="4.66" fill="#DD0000" />
      <rect y="9.33" width="20" height="4.67" fill="#FFCE00" />
    </svg>
  );
}

/**
 * Cambia el idioma con una cookie y refresca el árbol de servidor. Si hay
 * sesión, también se guarda en la cuenta para los correos.
 */
export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale) return;
    // `Secure` cuando hay TLS, como la cookie de sesión: es una preferencia,
    // pero no hay razón para que viaje en claro.
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
    void fetch("/api/account/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {
      // Sin sesión el endpoint devuelve 401: la cookie sigue mandando.
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="locale-switcher">
      {locale === "es" ? <FlagES /> : <FlagDE />}
      <select
        className="locale-select"
        value={locale}
        aria-label={t("Idioma")}
        disabled={pending}
        onChange={(event) => switchTo(event.target.value as Locale)}
      >
        <option value="de">DE</option>
        <option value="es">ES</option>
      </select>
    </div>
  );
}
