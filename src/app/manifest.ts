import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";
import { getLocale } from "@/lib/i18n-server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await getLocale();
  const de = locale === "de";
  return {
    name: de ? `${BRAND} · Bücher, die weiterreisen` : `${BRAND} · Libros que siguen viajando`,
    short_name: BRAND,
    description: de
      ? "Entdecke, teile und tausche gedruckte Bücher mit Leser:innen in deiner Stadt."
      : "Descubre, comparte e intercambia libros físicos con lectores de tu comunidad.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f6f1",
    theme_color: "#2f5741",
    lang: de ? "de" : "es",
    categories: ["books", "social"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
