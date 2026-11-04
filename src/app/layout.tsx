import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { I18nProvider } from "@/components/i18n-provider";
import { PwaRegister } from "@/components/pwa-register";
import { getLocale } from "@/lib/i18n-server";
import { BRAND } from "@/lib/brand";
import { siteUrl } from "@/lib/site";

export const viewport: Viewport = { themeColor: "#2f5741" };

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const de = locale === "de";
  const description = de
    ? "Entdecke, teile und tausche gedruckte Bücher mit Leser:innen in deiner Stadt."
    : "Descubre, comparte e intercambia libros físicos con lectores de tu comunidad.";
  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: `${BRAND} | ${de ? "Bücher, die weiterreisen" : "Libros que siguen viajando"}`,
      template: `%s | ${BRAND}`,
    },
    description,
    applicationName: BRAND,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    appleWebApp: {
      capable: true,
      title: BRAND,
      statusBarStyle: "default",
    },
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: de ? "de_DE" : "es_ES",
      siteName: BRAND,
      title: `${BRAND} | ${de ? "Bücher, die weiterreisen" : "Libros que siguen viajando"}`,
      description,
      url: "/",
    },
    twitter: {
      card: "summary",
      title: BRAND,
      description,
    },
    robots: { index: true, follow: true },
  };
}

/**
 * Aplica el tema guardado antes del primer pintado. Sin esto, quien eligió
 * «claro» sobre un sistema en oscuro ve un parpadeo en cada navegación SSR.
 */
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("b2p-theme");var d=s==="light"||s==="dark"?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=d}catch(e){}})()`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  // La CSP usa nonce por petición: el script en línea debe llevarlo.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // El script de tema escribe `data-theme` antes de hidratar: el atributo lo
    // pone el cliente y React debe tolerar la diferencia.
    <html lang={locale} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <I18nProvider locale={locale}>
          <PwaRegister />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
