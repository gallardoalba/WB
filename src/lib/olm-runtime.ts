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

/** Integridad SRI declarada en `/olm/integrity.json`, si el build la dejó. */
async function integrityFor(src: string): Promise<string | null> {
  try {
    const response = await fetch("/olm/integrity.json", { cache: "no-cache" });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      files?: Record<string, { integrity?: string }>;
    };
    const name = src.split("/").pop() ?? "";
    return data.files?.[name]?.integrity ?? null;
  } catch {
    return null;
  }
}

/**
 * Comprueba el WASM antes de inicializar libolm.
 *
 * El build ya verificó el paquete y `olm.js` se carga con SRI, pero el binario
 * `olm.wasm` lo pide el propio Emscripten. Se descarga aquí, se calcula su
 * SHA-256 y se compara con el que dejó `scripts/olm-assets.ts`; si no coincide,
 * no se inicializa el ratchet. En Node (pruebas) no hay `document` y se omite.
 */
export async function verifyOlmAssets(): Promise<void> {
  if (typeof document === "undefined") return;
  try {
    const manifest = await fetch("/olm/integrity.json", { cache: "no-cache" });
    if (!manifest.ok) return;
    const data = (await manifest.json()) as {
      files?: Record<string, { sha256?: string }>;
    };
    const expected = data.files?.["olm.wasm"]?.sha256;
    if (!expected) throw new Error("No hay hash para olm.wasm.");
    const wasm = await fetch("/olm/olm.wasm", { cache: "no-cache" });
    if (!wasm.ok) throw new Error("No se pudo descargar olm.wasm.");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await wasm.arrayBuffer()));
    const actual = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== expected) {
      throw new Error("El binario de libolm no coincide con el que se compiló.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No hay hash")) throw error;
    throw new Error(
      `No se pudo verificar la integridad de libolm: ${error instanceof Error ? error.message : "error desconocido"}`,
    );
  }
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
    void integrityFor(src)
      .then((integrity) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.dataset.olm = src;
        // Si el build no dejó `integrity.json` (por ejemplo, un `next dev`
        // antiguo) se carga igualmente: la comprobación de `prebuild` sigue
        // siendo la barrera principal.
        if (integrity) script.integrity = integrity;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No se pudo cargar libolm."));
        document.head.append(script);
      })
      .catch(() => reject(new Error("No se pudo cargar libolm.")));
  });
}
