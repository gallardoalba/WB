"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Tokens de un solo uso en la URL.
 *
 * Llegan como `?token=…`. Se probó el fragmento (`#token=…`), que el navegador
 * no manda al servidor, pero el redireccionador del proveedor de correo corta
 * el `#` y el clic aterrizaba en `/verificar` sin token. Se sigue aceptando
 * para los enlaces que ya salieron.
 *
 * Que el token no acabe en el registro lo resuelven tres cosas: el formato de
 * log de nginx anota `$uri` (sin la query), estas dos páginas se sirven con
 * `Referrer-Policy: no-referrer` y este hook borra el token de la barra en
 * cuanto lo lee.
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
  // Mismo patrón: en el HTML del servidor solo está lo que venga en la query,
  // así que el fragmento (enlaces antiguos) se resuelve justo después de hidratar.
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

  // `ready` evita enseñar «falta el enlace» mientras no se ha leído la URL: en
  // el HTML del servidor el token no existe por diseño.
  return { token, ready };
}
