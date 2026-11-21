/**
 * Cómo llega libolm a este módulo.
 *
 * El paquete `@matrix-org/olm` es un binario de Emscripten con ramas para Node
 * (`require("fs")`, `require("path")`): si el empaquetador del navegador lo ve,
 * intenta resolverlas y falla. Por eso **no se importa**: en el navegador se
 * sirve desde `/olm/olm.js` (lo copia `scripts/olm-assets.ts`) y se carga con
 * una etiqueta `script`; en Node lo inyecta quien lo tenga (las pruebas).
 *
 * Así el mismo código de protocolo funciona en los dos sitios sin duplicar la
 * envoltura.
 */

export type OlmFactory = {
  init: (opts?: object) => Promise<void>;
  Account: new () => unknown;
  Session: new () => unknown;
  Utility: new () => unknown;
};

let factory: OlmFactory | null = null;
let loading: Promise<void> | null = null;

/** Inyecta la implementación (pruebas en Node, o el cargador del navegador). */
export function setOlm(candidate: OlmFactory): void {
  factory = candidate;
}

/**
 * Devuelve libolm, cargándolo si hace falta.
 *
 * En el navegador añade `/olm/olm.js` una sola vez; si ya está en `globalThis`
 * —porque otra pestaña o un script anterior lo cargó— lo reutiliza.
 */
export async function getOlm(): Promise<OlmFactory> {
  if (factory) return factory;
  loading ??= (async () => {
    const global = globalThis as { Olm?: OlmFactory };
    if (!global.Olm) {
      if (typeof document === "undefined") {
        throw new Error("libolm no está disponible en este entorno.");
      }
      await loadScript("/olm/olm.js");
    }
    const loaded = (globalThis as { Olm?: OlmFactory }).Olm;
    if (!loaded) throw new Error("libolm no se pudo cargar.");
    factory = loaded;
  })();
  await loading;
  if (!factory) throw new Error("libolm no se pudo cargar.");
  return factory;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-olm="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("No se pudo cargar libolm.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.olm = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar libolm."));
    document.head.append(script);
  });
}
