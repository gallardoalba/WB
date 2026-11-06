import type { MetadataRoute } from "next";
import { connection } from "next/server";
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

  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    ...works.map((work) => ({
      url: `${base}/werk/${work.id}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    { url: `${base}/listas`, changeFrequency: "weekly", priority: 0.6 },
    ...lists
      // Una lista vacía no aporta nada al índice.
      .filter((list) => list.items > 0)
      .map((list) => ({
        url: `${base}/listas/${list.id}`,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      })),
    { url: `${base}/projekt`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/documentacion`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/privacidad`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/aviso-legal`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
