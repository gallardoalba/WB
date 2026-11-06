import { connection } from "next/server";
import { siteUrl } from "@/lib/site";

export default async function robots() {
  await connection();
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // El catálogo es público, pero indexarlo publicaría en Google el
        // nombre y la ciudad de cada lector junto a los libros que ofrece:
        // datos personales de terceros que nadie consintió. Se rastrea solo la
        // portada, igual que anuncia el sitemap.
        disallow: [
          "/api/",
          "/admin",
          "/descubrir",
          "/libro/",
          "/obra/",
          "/u/",
          "/lectores",
          "/comunidad",
          "/clubes",
          "/estanteria",
          "/intercambios",
          "/cuenta",
          "/ofrecer",
          "/verificar",
          "/restablecer",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
