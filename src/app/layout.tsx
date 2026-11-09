import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { I18nProvider, type Messages } from "@/components/i18n-provider";
import { PwaRegister } from "@/components/pwa-register";
import { DE, EN, translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { LOCALES, pick, type Locale } from "@/lib/locale";
import { messagesById } from "@/lib/message-id";
import { BRAND, MASTODON, REPOSITORY } from "@/lib/brand";
import { OG_COPY, OG_SIZE, ogImagePath } from "@/lib/og";
import { siteUrl } from "@/lib/site";

export const viewport: Viewport = { themeColor: "#2f5741" };

/** Título y descripción de la marca: los usan los metadatos y el JSON-LD. */
const SITE_TITLE = {
  // El título es lo que se ve en Google: lleva la consulta («Bücher tauschen»),
  // no solo el eslogan. La marca se añade con el `template` de las subpáginas.
  de: `Bücher tauschen und teilen in Europa | ${BRAND}`,
  es: `Intercambiar y compartir libros en Europa | ${BRAND}`,
  en: `Swap and share books in Europe | ${BRAND}`,
} as const;

const SITE_DESCRIPTION = {
  de: "Eine dezentrale Bibliothek, getragen von der Gemeinschaft, die glaubt, dass Wissen wächst, wenn Bücher, Ideen und Erfahrungen geteilt werden. Keine Werbung, kein Datenhandel.",
  es: "Una biblioteca descentralizada impulsada por la comunidad que cree que el conocimiento crece cuando se comparten libros, ideas y experiencias. Sin publicidad, sin venta de datos.",
  en: "A decentralised, community-driven library built on the belief that knowledge grows when books, ideas and experiences are shared. No ads, no data trading.",
} as const;

/**
 * Datos estructurados de la marca (`WebSite` + `Organization`).
 *
 * Es lo que permite a Google asociar «Wanderbibliothek» con este dominio y no
 * tratarlo como un sitio huérfano; `sameAs` enlaza la entidad con el repositorio
 * público del proyecto.
 */
function siteSchema(locale: Locale) {
  const base = siteUrl();
  const description = pick(locale, SITE_DESCRIPTION);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        url: `${base}/`,
        name: BRAND,
        description,
        // El sitio se publica en todos los idiomas de la interfaz.
        inLanguage: [...LOCALES],
        publisher: { "@id": `${base}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${base}/#organization`,
        name: BRAND,
        url: `${base}/`,
        description,
        logo: { "@type": "ImageObject", url: `${base}/icons/icon-512.png` },
        sameAs: [REPOSITORY, MASTODON],
      },
    ],
  };
}

/**
 * Diccionario alemán indexado por identificador: se calcula una vez por proceso
 * y es lo que viaja al navegador. Ver `src/lib/message-id.ts`.
 */
const DE_MESSAGES = messagesById(DE);
/** Lo mismo con el diccionario inglés: solo viaja a quien lee en inglés. */
const EN_MESSAGES = messagesById(EN);

/** Textos de cliente por idioma; el español es el origen y llega vacío. */
const MESSAGES: Record<Locale, Messages> = {
  es: {},
  de: DE_MESSAGES,
  en: EN_MESSAGES,
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = pick(locale, SITE_TITLE);
  const description = pick(locale, SITE_DESCRIPTION);
  // La tarjeta social se genera por idioma y tiene que ser la misma que anuncia
  // el `og:title`: si no, un enlace alemán se comparte con la tarjeta en
  // castellano.
  const ogImage = {
    url: ogImagePath(locale),
    width: OG_SIZE.width,
    height: OG_SIZE.height,
    alt: translate(locale, OG_COPY.alt),
  };
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
      locale: pick(locale, { es: "es_ES", de: "de_DE", en: "en_GB" }),
      siteName: BRAND,
      title,
      description,
      images: [ogImage],
    },
    twitter: {
      // La imagen de Open Graph es 1200×630; con `summary` se recortaba.
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
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
        {/* Las dos fuentes de la portadilla (títulos sin imagen) se descubrían
            al parsear el CSS: con `preload` empiezan antes y la portada de
            reserva no cambia de forma al aplicarse. Van con `crossOrigin`
            porque las fuentes siempre se piden en modo CORS. */}
        <link
          rel="preload"
          href="/fonts/tangerine-700.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/tangerine-400.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Enlace verificado del fediverso: Mastodon marca la cuenta como propia
            cuando esta página apunta a ella con `rel="me"`. Va en el encabezado
            y sin más valores de `rel` para que la comprobación no dependa de cómo
            los lea cada servidor. */}
        <link rel="me" href={MASTODON} />
      </head>
      <body>
        {/* Datos estructurados de la marca. Google los lee aunque abajo
            hidrate la aplicación. `</` escapado para no cerrar el <script>. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(siteSchema(locale)).replace(/</g, "\\u003c"),
          }}
        />
        <I18nProvider locale={locale} messages={MESSAGES[locale]}>
          <PwaRegister />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
