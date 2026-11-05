"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Tokens de un solo uso en la URL.
 *
 * Van en el fragmento (`/restablecer#token=…`), que el navegador **no envía al
 * servidor**: así no acaban en los registros de nginx, en un proxy ni en el
 * `Referer` de ningún recurso. Antes viajaban como `?token=`, y un token de
 * restablecimiento quedaba escrito en el log de accesos de cada visita.
 *
 * Se acepta también `?token=` para que los enlaces ya enviados por correo sigan
 * funcionando.
 *
 * `useSyncExternalStore` es lo que permite leerlo sin romper la hidratación: en
 * el servidor devuelve el valor del HTML y, en cuanto hidrata, el del navegador.
 */

function readToken(initial: string): string {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  const query = new URLSearchParams(window.location.search).get("token");
  return hash ?? query ?? initial;
}

/** Suscripción vacía: la URL no cambia sin navegar. */
const subscribe = () => () => {};

export function useUrlToken(initial = ""): { token: string; ready: boolean } {
  // `false` en el servidor y en el primer render de hidratación; `true` después.
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  // Mismo patrón: el servidor solo conoce `?token=`, así que el fragmento se
  // resuelve justo después de hidratar.
  const token = useSyncExternalStore(
    subscribe,
    () => readToken(initial),
    () => initial,
  );

  useEffect(() => {
    // El token deja de estar a la vista en cuanto se lee (queda en el historial
    // del navegador, pero ya sin exponerlo). Vale también para `?token=`.
    if (ready && token && window.location.href.includes("token=")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [ready, token]);

  // `ready` evita enseñar «falta el enlace» mientras no se ha leído el
  // fragmento: en el HTML del servidor el token no existe por diseño.
  return { token, ready };
}
