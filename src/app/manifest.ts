import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";
import { getLocale } from "@/lib/i18n-server";
import { pick } from "@/lib/locale";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await getLocale();
  return {
    name: pick(locale, {
      de: `${BRAND} · Bücher, die weiterreisen`,
      es: `${BRAND} · Libros que siguen viajando`,
      en: `${BRAND} · Books that keep travelling`,
    }),
    short_name: BRAND,
    description: pick(locale, {
      de: "Bücher tauschen und weitergeben: kostenlos, ohne Werbung, ohne Datenhandel.",
      es: "Comparte e intercambia libros: gratis, sin publicidad ni venta de datos.",
      en: "Swap and share books: free, no ads, no data trading.",
    }),
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f6f1",
    theme_color: "#2f5741",
    lang: locale,
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
