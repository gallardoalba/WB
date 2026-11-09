"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Último recurso de la aplicación.
 *
 * `error.tsx` cubre los fallos de una página, pero no los del layout raíz: para
 * esos Next pide este archivo, que **sustituye** al layout y por eso trae su
 * propio `<html>`/`<body>`. Como el proveedor de idiomas vive en el layout que
 * ha fallado, aquí no hay `t()`: los textos van incrustados en los tres idiomas
 * y se elige el del navegador.
 *
 * Los estilos también van incrustados: si el layout no llegó a montarse, no hay
 * garantía de que la hoja de estilos global esté aplicada. El mapa se llama
 * `TEXTS` (y no `*_COPY`) a propósito: `tests/i18n.test.ts` exige traducción de
 * diccionario para los mapas `*_COPY`, y estos textos existen precisamente para
 * cuando el diccionario no se puede cargar.
 */
const TEXTS = {
  de: {
    lang: "de",
    title: "Etwas ist schiefgelaufen",
    body: "Die Seite konnte nicht geladen werden. Versuche es noch einmal; wenn es weiterhin passiert, geh in ein paar Minuten zurück zum Katalog.",
    retry: "Erneut versuchen",
    home: "Zum Katalog",
  },
  es: {
    lang: "es",
    title: "Algo no ha ido bien",
    body: "No pudimos cargar esta página. Puedes intentarlo de nuevo; si el problema continúa, vuelve al catálogo en unos minutos.",
    retry: "Reintentar",
    home: "Ir al catálogo",
  },
  en: {
    lang: "en",
    title: "Something went wrong",
    body: "We could not load this page. Try again; if the problem continues, come back to the catalogue in a few minutes.",
    retry: "Try again",
    home: "Go to the catalogue",
  },
} as const;

type Lang = keyof typeof TEXTS;

function browserLang(): Lang {
  const tags = [navigator.language, ...navigator.languages];
  for (const tag of tags) {
    const base = tag?.slice(0, 2).toLowerCase();
    if (base === "es" || base === "de" || base === "en") return base;
  }
  return "de";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [lang, setLang] = useState<Lang>("de");

  useEffect(() => {
    console.error("[app] error no controlado en el layout raíz", error);
  }, [error]);

  useEffect(() => {
    // El idioma sale del navegador y no se puede leer durante el render sin
    // provocar una diferencia de hidratación; aquí el aviso del linter no
    // aplica porque el valor solo existe en el cliente.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLang(browserLang());
  }, []);

  const copy = TEXTS[lang];

  return (
    <html lang={copy.lang}>
      <head>
        <title>{copy.title}</title>
        <style>{`
          html { color-scheme: light dark; }
          body {
            margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
            background: #f7f6f1; color: #24352b;
            font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          }
          .wb-error { max-width: 42rem; border: 1px solid #d9c6a2; border-radius: 14px;
            padding: 32px; background: #fff; }
          .wb-error h1 { font-size: 1.5rem; margin: 0 0 10px; }
          .wb-error p { margin: 0 0 22px; line-height: 1.55; }
          .wb-error button, .wb-error a { font: inherit; border-radius: 10px;
            padding: 10px 18px; cursor: pointer; }
          .wb-error button { border: 1px solid #7c8175; background: transparent; color: inherit; }
          .wb-error a { display: inline-block; margin-left: 8px; background: #2f5741;
            color: #f7f6f1; text-decoration: none; }
          .wb-error button:focus-visible, .wb-error a:focus-visible {
            outline: 2px solid #2f5741; outline-offset: 2px; }
          @media (prefers-color-scheme: dark) {
            body { background: #16211a; color: #e6eee3; }
            .wb-error { background: #1d2a22; border-color: #3a4b3d; }
            .wb-error a { background: #9fd3b4; color: #16211a; }
            .wb-error button:focus-visible, .wb-error a:focus-visible { outline-color: #9fd3b4; }
          }
        `}</style>
      </head>
      <body>
        <main className="wb-error" role="alert">
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <button type="button" onClick={reset}>
            {copy.retry}
          </button>
          {/* `Link` y no `<button>`: si el fallo fue del layout, un enlace
              normal sigue funcionando (y sin JS se comporta como `<a>`). */}
          <Link href="/">{copy.home}</Link>
        </main>
      </body>
    </html>
  );
}
