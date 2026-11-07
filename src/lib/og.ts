import type { Locale } from "./locale";

/** Tamaño de la tarjeta social: el que esperan Open Graph y Twitter. */
export const OG_SIZE = { width: 1200, height: 630 } as const;

/** Ruta de la imagen de cada idioma (`/api/og/es`, `/api/og/de`, `/api/og/en`). */
export function ogImagePath(locale: Locale): string {
  return `/api/og/${locale}`;
}

/**
 * Textos de la tarjeta social, en castellano: es el idioma de origen y el
 * alemán y el inglés salen del diccionario (`translate`), igual que el resto de
 * la interfaz. La tarjeta no habla de catálogo: dice qué es el proyecto y con
 * qué valores funciona, que es lo que se puede afirmar sin prometer de más.
 *
 * El nombre `_COPY` no es casual: `tests/i18n.test.ts` recorre estos mapas y
 * exige traducción para cada texto, porque al pasarse a `translate()` de forma
 * dinámica el escáner de literales no los ve.
 */
export const OG_COPY = {
  kicker: "Libros, ideas y experiencias",
  headline: "Una biblioteca hecha por su comunidad",
  subline: "Comparte los libros que ya has leído y descubre los que buscan lector cerca de ti.",
  valueNonProfit: "Sin ánimo de lucro",
  valueOpenSource: "Código abierto",
  valueNoAds: "Sin anuncios",
  alt: "Wanderbibliothek: el lema «Una biblioteca hecha por su comunidad» sobre fondo verde, junto a una estantería de libros",
} as const;
