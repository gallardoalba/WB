"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, localePath, splitLocalePath, type Locale } from "@/lib/locale";
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

/** Union Jack simplificado: aspas blancas con la roja encima y la cruz central. */
function FlagEN() {
  return (
    <svg className="locale-flag" viewBox="0 0 20 14" aria-hidden="true">
      <rect width="20" height="14" fill="#012169" />
      <path d="M0 0 20 14M20 0 0 14" stroke="#FFFFFF" strokeWidth="2.8" />
      <path d="M0 0 20 14M20 0 0 14" stroke="#C8102E" strokeWidth="1.2" />
      <path d="M10 0V14M0 7H20" stroke="#FFFFFF" strokeWidth="4.6" />
      <path d="M10 0V14M0 7H20" stroke="#C8102E" strokeWidth="2.8" />
    </svg>
  );
}

/**
 * Cambia el idioma con una cookie y refresca el árbol de servidor. Si hay
 * sesión, también se guarda en la cuenta para los correos.
 *
 * Cuando la página se abrió con el idioma en la URL (`/es/…`, `/en/…`) hay que
 * moverse a la dirección del idioma elegido: ahí manda el prefijo, y sin el
 * cambio de URL el selector parecería no hacer nada. El alemán es el idioma por
 * defecto y su URL no lleva prefijo.
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
    const conPrefijo = splitLocalePath(window.location.pathname);
    const interno = conPrefijo ? conPrefijo.path : window.location.pathname;
    const destino = `${localePath(next, interno)}${window.location.search}`;
    startTransition(() => {
      // Recarga completa, no `router.push`: el idioma vive en el layout raíz
      // (`<html lang>`, el proveedor de textos), que no se vuelve a pintar en
      // una navegación de cliente. Solo así cambian de verdad el idioma y la
      // dirección con su prefijo.
      if (destino === `${window.location.pathname}${window.location.search}`) {
        router.refresh();
      } else {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- el idioma vive en el layout raíz: solo una recarga completa lo aplica
        window.location.assign(destino);
      }
    });
  }

  return (
    <div className="locale-switcher">
      {locale === "es" ? <FlagES /> : locale === "de" ? <FlagDE /> : <FlagEN />}
      <select
        className="locale-select"
        value={locale}
        aria-label={t("Idioma")}
        disabled={pending}
        onChange={(event) => switchTo(event.target.value as Locale)}
      >
        <option value="de">DE</option>
        <option value="es">ES</option>
        <option value="en">EN</option>
      </select>
    </div>
  );
}
