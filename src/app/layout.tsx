import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { I18nProvider } from "@/components/i18n-provider";
import { PwaRegister } from "@/components/pwa-register";
import { DE } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { messagesById } from "@/lib/message-id";
import { BRAND, REPOSITORY } from "@/lib/brand";
import { siteUrl } from "@/lib/site";

export const viewport: Viewport = { themeColor: "#2f5741" };

/** Título y descripción de la marca: los usan los metadatos y el JSON-LD. */
const SITE_TITLE = {
  // El título es lo que se ve en Google: lleva la consulta («Bücher tauschen»),
  // no solo el eslogan. La marca se añade con el `template` de las subpáginas.
  de: `Bücher tauschen und teilen in Deutschland | ${BRAND}`,
  es: `Intercambiar y compartir libros en Alemania | ${BRAND}`,
} as const;

const SITE_DESCRIPTION = {
  de: "Kostenlose Tauschbörse für gedruckte Bücher: Buch einstellen, Bücher in deiner Stadt finden und persönlich oder per Post weitergeben.",
  es: "Mercado gratuito de intercambio de libros físicos: publica un ejemplar, encuentra libros en tu ciudad y entrégalos en mano o por correo.",
} as const;

/**
 * Datos estructurados de la marca (`WebSite` + `Organization`).
 *
 * Es lo que permite a Google asociar «Wanderbibliothek» con este dominio y no
 * tratarlo como un sitio huérfano; `sameAs` enlaza la entidad con el repositorio
 * público del proyecto.
 */
function siteSchema(de: boolean) {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        url: `${base}/`,
        name: BRAND,
        description: SITE_DESCRIPTION[de ? "de" : "es"],
        inLanguage: ["de", "es"],
        publisher: { "@id": `${base}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${base}/#organization`,
        name: BRAND,
        url: `${base}/`,
        description: SITE_DESCRIPTION[de ? "de" : "es"],
        logo: { "@type": "ImageObject", url: `${base}/icons/icon-512.png` },
        sameAs: [REPOSITORY],
      },
    ],
  };
}

/**
 * Diccionario alemán indexado por identificador: se calcula una vez por proceso
 * y es lo que viaja al navegador. Ver `src/lib/message-id.ts`.
 */
const DE_MESSAGES = messagesById(DE);

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const de = locale === "de";
  const title = SITE_TITLE[de ? "de" : "es"];
  const description = SITE_DESCRIPTION[de ? "de" : "es"];
  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: title,
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
    // Sin `alternates` aquí: el canonical de la portada lo pone `app/page.tsx`.
    // Puesto en el layout lo heredarían las páginas que no lo definen, y
    // anunciarían «esta página es un duplicado de /».
    openGraph: {
      type: "website",
      locale: de ? "de_DE" : "es_ES",
      siteName: BRAND,
      title,
      description,
    },
    twitter: {
      // La imagen de Open Graph es 1200×630; con `summary` se recortaba.
      card: "summary_large_image",
      title,
      description,
    },
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
        {/* Datos estructurados de la marca. Google los lee aunque abajo
            hidrate la aplicación. `</` escapado para no cerrar el <script>. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(siteSchema(locale === "de")).replace(/</g, "\\u003c"),
          }}
        />
        <I18nProvider locale={locale} messages={locale === "de" ? DE_MESSAGES : {}}>
          <PwaRegister />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
