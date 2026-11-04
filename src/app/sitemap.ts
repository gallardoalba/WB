import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * Solo la portada es pública. El resto de páginas (fichas, perfiles, clubes,
 * listas, lectores) exigen sesión, así que no se anuncian a los buscadores.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [{ url: siteUrl(), changeFrequency: "daily", priority: 1 }];
}
