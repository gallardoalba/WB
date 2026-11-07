import type { Metadata } from "next";
import { HREFLANG, LOCALES, localePath, type Locale } from "./locale";

/**
 * Canonical y `hreflang` de una página pública.
 *
 * Cada idioma se anuncia a sí mismo como canonical y declara a los otros dos
 * como alternativos; `x-default` apunta al alemán, que es lo que ve quien llega
 * sin cookie ni prefijo. Sin esto, Google solo conoce la versión alemana y las
 * búsquedas en castellano o inglés nunca llegan a la web.
 *
 * El `path` es la ruta interna sin prefijo (`/werk/x`), la misma que ya usa
 * cada página en su canonical.
 */
export function alternatesFor(locale: Locale, path: string): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const alternate of LOCALES) {
    languages[HREFLANG[alternate]] = localePath(alternate, path);
  }
  languages["x-default"] = localePath("de", path);
  return { canonical: localePath(locale, path), languages };
}
