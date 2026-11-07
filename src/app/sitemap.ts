import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { HREFLANG, LOCALES, localePath } from "@/lib/locale";
import { listPublicReadingLists, listPublicWorks } from "@/lib/repo";
import { siteUrl } from "@/lib/site";

/** Tope defensivo: hoy hay muchas menos, pero un sitemap no debe crecer sin límite. */
const MAX_LISTS = 480;

/**
 * Mapa del sitio público.
 *
 * Anuncia solo lo que puede ver cualquiera sin cuenta: la portada, el catálogo
 * público, las fichas de obra (con al menos un ejemplar disponible), las listas
 * de lectura, las reseñas y las páginas de información. Los perfiles, las fichas
 * de ejemplar y el resto de vistas con sesión siguen fuera: publicarlas
 * expondría datos personales.
 *
 * `connection()` es imprescindible: sin él Next prerenderiza esta ruta en el
 * BUILD, donde `NEXT_PUBLIC_SITE_URL` no está definida (el build no necesita
 * entorno), y el sitemap publicado anunciaría `http://localhost:3000`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const base = siteUrl();
  const works = listPublicWorks();

  // Las listas se piden página a página: el escaparate devuelve como mucho 48.
  const lists = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = listPublicReadingLists({ viewerId: null, page, pageSize: 48 });
    lists.push(...result.lists);
    if (!result.hasMore || lists.length >= MAX_LISTS) break;
  }

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
    ...works.map((work) => entry(`/werk/${work.id}`, "weekly", 0.7)),
    entry("/listas", "weekly", 0.6),
    ...lists
      // Una lista vacía no aporta nada al índice.
      .filter((list) => list.items > 0)
      .map((list) => entry(`/listas/${list.id}`, "monthly", 0.5)),
    entry("/projekt", "yearly", 0.4),
    entry("/documentacion", "monthly", 0.4),
    entry("/privacidad", "yearly", 0.3),
    entry("/aviso-legal", "yearly", 0.3),
  ];
}
