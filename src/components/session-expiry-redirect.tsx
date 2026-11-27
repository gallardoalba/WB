"use client";

import { useEffect } from "react";
import { localePath } from "@/lib/locale";
import { useI18n } from "./i18n-provider";

/**
 * Las páginas de `SiteShell` no tienen el diálogo de acceso del armazón
 * principal. Si la sesión caduca al guardar el perfil, seguir a alguien o
 * cerrar una sesión, `client-api` avisa con `wb:auth-required`: aquí se vuelve
 * al acceso con la página actual como destino, en vez de dejar un error sin
 * salida.
 */
export function SessionExpiryRedirect() {
  const { locale } = useI18n();

  useEffect(() => {
    function onAuthRequired() {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(
        localePath(locale, `/?auth=1&next=${encodeURIComponent(next)}`),
      );
    }
    window.addEventListener("wb:auth-required", onAuthRequired);
    return () => window.removeEventListener("wb:auth-required", onAuthRequired);
  }, [locale]);

  return null;
}
