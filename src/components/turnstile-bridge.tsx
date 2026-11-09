"use client";

import { useEffect, useRef } from "react";

/**
 * Puente de Turnstile para la app Android.
 *
 * La app no puede pintar el widget por sí misma: Cloudflare valida el dominio de
 * la página que lo incrusta, y un `file://` o un origen nulo no pasa la
 * comprobación. Así que la app abre esta página **del propio servidor** en un
 * `WebView` y recibe el token por una interfaz JavaScript (`WbTurnstile`).
 *
 * En un navegador normal no hay interfaz y la página no hace nada más que
 * mostrar el aviso: es una página de servicio, no una pantalla de la web.
 */

type Bridge = {
  token?: (value: string) => void;
  required?: (value: boolean) => void;
};

declare global {
  interface Window {
    WbTurnstile?: Bridge;
    turnstile?: {
      render: (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => string | undefined;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function TurnstileBridge() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Sin clave configurada no hay nada que verificar: se lo decimos a la app
    // para que no exija el token al enviar el formulario.
    if (!SITE_KEY) {
      window.WbTurnstile?.required?.(false);
      return;
    }
    window.WbTurnstile?.required?.(true);

    let cancelled = false;
    const render = () => {
      if (cancelled || !window.turnstile || !container.current) return;
      window.turnstile.render(container.current, {
        sitekey: SITE_KEY,
        theme: "auto",
        callback: (token: string) => {
          window.WbTurnstile?.token?.(token);
        },
        // Un token caducado deja de valer: la app vuelve a exigirlo.
        "expired-callback": () => {
          window.WbTurnstile?.token?.("");
        },
        "error-callback": () => {
          window.WbTurnstile?.token?.("");
        },
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT}"]`);
    if (existing) {
      if (window.turnstile) render();
      else existing.addEventListener("load", render, { once: true });
    } else {
      const script = document.createElement("script");
      script.src = SCRIPT;
      script.async = true;
      // La CSP usa nonce + `strict-dynamic`: un script creado por código que ya
      // se ejecutó (este componente) está permitido sin nonce.
      script.addEventListener("load", render, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="turnstile-bridge">
      <div ref={container} />
      {!SITE_KEY && (
        <p className="form-hint">Turnstile no está configurado en este servidor.</p>
      )}
    </div>
  );
}
