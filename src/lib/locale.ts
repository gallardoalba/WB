/**
 * Idioma de la interfaz.
 *
 * Vive en su propio módulo a propósito: lo usan componentes de cliente y no
 * puede arrastrar los diccionarios alemán e inglés al navegador. El diccionario
 * y la función `translate` están en `i18n.ts`, que solo se importa en el
 * servidor.
 */

export const LOCALES = ["es", "de", "en"] as const;
export type Locale = (typeof LOCALES)[number];
/** Idioma de la interfaz cuando nadie ha elegido: el alemán. */
export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_COOKIE = "wanderbibliothek-locale";
/**
 * Cabecera interna con el idioma que fija la URL (`/es/...`). La pone el proxy
 * y la lee `getLocale()` en el servidor; no sale al navegador.
 */
export const LOCALE_HEADER = "x-wb-locale";

/**
 * Cualquier valor de cookie o cabecera se reduce a un idioma soportado. Se
 * acepta la forma regional (`de-DE`, `es-ES`, `en-GB`), porque una cabecera
 * `Accept-Language` también acaba aquí; lo que no se reconoce cae al idioma por
 * defecto, nunca a una clave técnica.
 */
export function normalizeLocale(value: string | null | undefined): Locale {
  const base = (value ?? "").trim().toLowerCase().split("-")[0];
  return base === "es" || base === "de" || base === "en" ? base : DEFAULT_LOCALE;
}

/**
 * Primer idioma admitido de una cabecera `Accept-Language` (o de cualquier
 * lista de etiquetas), o `null` si ninguno de los que pide lo está.
 *
 * Se respeta el orden —que ya es el de preferencia— y se descartan las entradas
 * con `q=0`, que significan «este no». Así una primera visita en un navegador
 * castellano ve la interfaz en castellano, y el alta guarda ese idioma en la
 * cuenta para los correos.
 */
export function matchLocale(header: string | null | undefined): Locale | null {
  for (const part of (header ?? "").split(",")) {
    const [rawTag, ...params] = part.split(";");
    const tag = (rawTag ?? "").trim().toLowerCase();
    if (!tag) continue;
    if (params.some((param) => /^\s*q\s*=\s*0(\.0*)?\s*$/.test(param))) continue;
    const base = tag.split("-")[0];
    if (base === "es" || base === "de" || base === "en") return base;
    if (tag === "*") return DEFAULT_LOCALE;
  }
  return null;
}

/**
 * Etiqueta BCP-47 que espera `Intl` para números, fechas y horas.
 */
export function localeTag(locale: Locale): string {
  if (locale === "de") return "de-DE";
  if (locale === "en") return "en-GB";
  return "es-ES";
}

/**
 * Texto en el idioma activo para los pocos casos que no pasan por el
 * diccionario (mensajes de error de una página, `metadata`…):
 * `pick(locale, { es: "…", de: "…", en: "…" })`. El tipo exige los tres
 * idiomas, así que añadir uno nuevo rompe la compilación en vez de mostrar el
 * texto de otro idioma.
 */
export function pick(locale: Locale, values: Record<Locale, string>): string {
  return values[locale] ?? values[DEFAULT_LOCALE];
}

/**
 * Prefijo de URL de cada idioma.
 *
 * El alemán es el idioma por defecto y va **sin** prefijo (`/werk/x`), que es
 * también el `x-default` para los buscadores. Los otros dos se publican en su
 * propia URL (`/es/werk/x`, `/en/werk/x`) para que Google pueda indexarlos: con
 * el idioma solo en una cookie, el rastreador ve siempre la versión alemana y
 * las otras dos no existen para él.
 */
export const LOCALE_PREFIX: Record<Locale, string> = { de: "", es: "/es", en: "/en" };

/** Ruta pública de un idioma: `localePath("es", "/werk/x")` → `/es/werk/x`. */
export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const prefix = LOCALE_PREFIX[locale];
  if (!prefix) return clean;
  return clean === "/" ? prefix : `${prefix}${clean}`;
}

/**
 * Separa el prefijo de idioma de una ruta: `/es/werk/x` → `{ locale: "es", path: "/werk/x" }`.
 * Devuelve `null` si la ruta no lleva prefijo (o si el primer segmento solo lo
 * empieza, como `/escribir`).
 */
export function splitLocalePath(pathname: string): { locale: Locale; path: string } | null {
  const match = /^\/(es|en|de)(?=\/|$)/.exec(pathname);
  if (!match) return null;
  const rest = pathname.slice(match[0].length);
  return { locale: match[1] as Locale, path: rest === "" ? "/" : rest };
}

/** Etiqueta `hreflang` de cada idioma, la que espera Google. */
export const HREFLANG: Record<Locale, string> = {
  de: "de-DE",
  es: "es-ES",
  en: "en-GB",
};
