import { connection } from "next/server";
import { BRAND } from "@/lib/brand";
import { listPublicWorks } from "@/lib/repo";
import { siteUrl } from "@/lib/site";

/**
 * Feed RSS del catálogo público (`/feed.xml`).
 *
 * Anuncia solo lo mismo que el sitemap: obras con al menos un ejemplar
 * disponible, sin nombres ni ciudades de personas concretas (las cifras van
 * agregadas por ciudad). Es la única vía por la que alguien puede seguir la
 * biblioteca sin dar su correo ni una cuenta, que es justo el espíritu del
 * proyecto.
 *
 * `connection()` es obligatorio: sin él Next prerenderiza la ruta en el build,
 * donde `NEXT_PUBLIC_SITE_URL` no existe, y el feed publicado anunciaría
 * `http://localhost:3000`.
 */

const MAX_ITEMS = 50;

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET(): Promise<Response> {
  await connection();
  const base = siteUrl();
  const works = listPublicWorks({ limit: MAX_ITEMS });

  const items = works.map((work) => {
    const url = `${base}/werk/${work.id}`;
    const ciudades = work.cities
      .slice(0, 4)
      .map((city) => `${city.city} (${city.copies})`)
      .join(", ");
    const detalles = [
      `${work.author}`,
      work.year ? `${work.year}` : null,
      work.copies === 1 ? "1 Exemplar" : `${work.copies} Exemplare`,
      ciudades ? `in ${ciudades}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return [
      "    <item>",
      `      <title>${escapar(work.title)}</title>`,
      `      <link>${escapar(url)}</link>`,
      `      <guid isPermaLink="true">${escapar(url)}</guid>`,
      `      <category>${escapar(work.category)}</category>`,
      `      <description>${escapar(detalles)}</description>`,
      "    </item>",
    ].join("\n");
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapar(BRAND)}</title>`,
    `    <link>${escapar(base)}</link>`,
    `    <description>${escapar(
      "Bücher, die in der Nachbarschaft weiterwandern: der öffentliche Katalog.",
    )}</description>`,
    "    <language>de</language>",
    `    <atom:link href="${escapar(`${base}/feed.xml`)}" rel="self" type="application/rss+xml" />`,
    `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      // Cinco minutos de caché en la CDN/proxy: el catálogo no cambia más
      // rápido y así el feed no golpea SQLite con cada lector.
      "cache-control": "public, max-age=300",
    },
  });
}
