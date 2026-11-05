/**
 * Idioma de la interfaz.
 *
 * Vive en su propio módulo a propósito: lo usan componentes de cliente y no
 * puede arrastrar el diccionario alemán al navegador. El diccionario y la
 * función `translate` están en `i18n.ts`, que solo se importa en el servidor.
 */

export const LOCALES = ["es", "de"] as const;
export type Locale = (typeof LOCALES)[number];
/** Idioma de la interfaz cuando nadie ha elegido: el alemán. */
export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_COOKIE = "wanderbibliothek-locale";

/**
 * Cualquier valor de cookie o cabecera se reduce a un idioma soportado. Se
 * acepta la forma regional (`de-DE`, `es-ES`), porque una cabecera
 * `Accept-Language` también acaba aquí; lo que no se reconoce cae al idioma por
 * defecto, nunca a una clave técnica.
 */
export function normalizeLocale(value: string | null | undefined): Locale {
  const base = (value ?? "").trim().toLowerCase().split("-")[0];
  return base === "es" || base === "de" ? base : DEFAULT_LOCALE;
}
