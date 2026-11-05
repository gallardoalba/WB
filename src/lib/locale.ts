/**
 * Idioma de la interfaz.
 *
 * Vive en su propio módulo a propósito: lo usan componentes de cliente y no
 * puede arrastrar el diccionario alemán al navegador. El diccionario y la
 * función `translate` están en `i18n.ts`, que solo se importa en el servidor.
 */

export const LOCALES = ["es", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
export const LOCALE_COOKIE = "wanderbibliothek-locale";

/** Cualquier valor de cookie o cabecera se reduce a un idioma soportado. */
export function normalizeLocale(value: string | null | undefined): Locale {
  return value === "de" ? "de" : DEFAULT_LOCALE;
}
