import type { Metadata } from "next";

import { BRAND } from "./brand";
import { HREFLANG, LOCALES, localePath, type Locale } from "./locale";
import { OG_SIZE, ogImagePath } from "./og";
import { siteUrl } from "./site";

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

/** Código de idioma que espera Open Graph (`es_ES`, no `es-ES`). */
export function ogLocale(locale: Locale): string {
  if (locale === "es") return "es_ES";
  if (locale === "en") return "en_GB";
  return "de_DE";
}

/** Convierte una ruta interna en absoluta: `og:image` relativa no sirve. */
function absolute(urlOrPath: string): string {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  const base = siteUrl().replace(/\/+$/, "");
  return `${base}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
}

/**
 * Tarjetas sociales de una página: Open Graph y Twitter, en sintonía.
 *
 * Existe por un fallo que no se ve en el navegador: definir `openGraph` en una
 * página **sustituye** el objeto entero del layout, no lo completa. Cada ficha
 * que declaraba el suyo se quedaba sin `images`, y con ello sin tarjeta de vista
 * previa al compartir el enlace —Mastodon, WhatsApp y Telegram no muestran nada
 * sin `og:image`— mientras Twitter seguía anunciando el título genérico del
 * sitio. Aquí se componen los dos a la vez y con URLs absolutas.
 *
 * `image` admite una ruta interna (la portada, `/api/cover/…`); si falta, se usa
 * la tarjeta del sitio en el idioma activo.
 */
export function socialMetadata(input: {
  locale: Locale;
  /** Ruta interna sin prefijo de idioma (`/werk/x`). */
  path: string;
  title: string;
  description: string;
  /** Imagen propia, absoluta o interna. Sin ella, la tarjeta del sitio. */
  image?: string | null;
  type: "website" | "article" | "profile" | "book";
}): Pick<Metadata, "openGraph" | "twitter"> {
  const images = [
    {
      url: input.image ? absolute(input.image) : absolute(ogImagePath(input.locale)),
      alt: input.title,
      ...(input.image ? {} : { width: OG_SIZE.width, height: OG_SIZE.height }),
    },
  ];
  const url = absolute(localePath(input.locale, input.path));
  return {
    openGraph: {
      type: input.type,
      title: input.title,
      description: input.description,
      url,
      siteName: BRAND,
      locale: ogLocale(input.locale),
      images,
      // `type` es una unión de literales en los tipos de Next; el objeto se
      // construye con el valor ya comprobado por la firma de esta función.
    } as Metadata["openGraph"],
    twitter: {
      // La imagen es apaisada: con `summary` se recortaba a un cuadrado.
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images,
    },
  };
}
