import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { siteUrl } from "@/lib/site";

/**
 * Solo la portada es pública. El resto de páginas (fichas, perfiles, clubes,
 * listas, lectores) exigen sesión, así que no se anuncian a los buscadores.
 *
 * `connection()` es imprescindible: sin él Next prerenderiza esta ruta en el
 * BUILD, donde `NEXT_PUBLIC_SITE_URL` no está definida (el build no necesita
 * entorno), y el sitemap publicado anunciaría `http://localhost:3000`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  return [{ url: siteUrl(), changeFrequency: "daily", priority: 1 }];
}
