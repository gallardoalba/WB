import type { Metadata } from "next";
import { BRAND } from "./brand";
import { HREFLANG, LOCALES, localePath, type Locale } from "./locale";

/**
 * Título y descripción de la portada.
 *
 * Viven aquí (y no en `layout.tsx`) para que se puedan probar sin importar el
 * componente, que arrastra el CSS. El título lleva la consulta que busca la
 * gente («Bücher tauschen»), no solo el eslogan: la marca la añade el
 * `template` de las subpáginas.
 *
 * La descripción dice qué se puede hacer y dónde, y cabe en un resultado de
 * Google (~155 caracteres). La frase anterior —«una biblioteca descentralizada
 * impulsada por la comunidad que cree que el conocimiento crece…»— no decía
 * nada concreto y Google la sustituía por un trozo de la página: ahora la
 * portada abre con esta misma frase, así que el `<meta>` y el texto visible
 * dicen lo mismo.
 */
export const SITE_TITLE: Record<Locale, string> = {
  de: `Bücher tauschen und teilen in Europa | ${BRAND}`,
  es: `Intercambiar y compartir libros en Europa | ${BRAND}`,
  en: `Swap and share books in Europe | ${BRAND}`,
};

export const SITE_DESCRIPTION: Record<Locale, string> = {
  de: "Bücher tauschen und weitergeben: stelle deine gelesenen Bücher ein und finde neue in deiner Nähe. Kostenlos, ohne Werbung, ohne Datenhandel.",
  es: "Comparte e intercambia libros: publica los que ya has leído y encuentra otros cerca de ti. Gratis, sin publicidad ni venta de datos.",
  en: "Swap and share books with readers near you: list the ones you have read and find new ones. Free, no ads, no data trading.",
};

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
