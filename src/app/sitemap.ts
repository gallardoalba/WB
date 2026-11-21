import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { HREFLANG, LOCALES, localePath } from "@/lib/locale";
import { siteUrl } from "@/lib/site";

/**
 * Mapa del sitio público.
 *
 * Solo anuncia páginas informativas que se desean indexar. Las obras, el
 * catálogo, las listas y los perfiles llevan `noindex` y se omiten aunque sean
 * públicos: pueden contener datos personales o preferencias de lectura.
 *
 * `connection()` es imprescindible: sin él Next prerenderiza esta ruta en el
 * BUILD, donde `NEXT_PUBLIC_SITE_URL` no está definida (el build no necesita
 * entorno), y el sitemap publicado anunciaría `http://localhost:3000`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const base = siteUrl();

  // Cada página se anuncia en los tres idiomas, con la misma relación de
  // alternativas que llevan sus `hreflang`: así Google descubre `/es/…` y
  // `/en/…` sin esperar a que alguien enlace a ellas. La URL sin prefijo es la
  // alemana y también el `x-default`.
  const entry = (
    path: string,
    changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>,
    priority: number,
  ): MetadataRoute.Sitemap[number] => {
    const languages: Record<string, string> = {};
    for (const alternate of LOCALES) {
      languages[HREFLANG[alternate]] = `${base}${localePath(alternate, path)}`;
    }
    languages["x-default"] = `${base}${localePath("de", path)}`;
    return {
      url: `${base}${localePath("de", path)}`,
      changeFrequency,
      priority,
      alternates: { languages },
    };
  };

  return [
    entry("/", "daily", 1),
    entry("/projekt", "yearly", 0.4),
    entry("/normas", "yearly", 0.4),
    entry("/techdoc", "monthly", 0.4),
    entry("/datenschutz", "yearly", 0.3),
    entry("/aviso-legal", "yearly", 0.3),
  ];
}
