import { ImageResponse } from "next/og";
import { translate } from "@/lib/i18n";
import { matchLocale } from "@/lib/locale";
import { OG_COPY, OG_SIZE } from "@/lib/og";
import { ogRateLimit } from "@/lib/og-limit";

/* El mismo libro abierto del icono de la app, incrustado como SVG: Satori no
   tiene las fuentes ni los recursos del sitio, así que la marca viaja dentro
   de la propia imagen. */
const BOOK_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2f5741"/><g fill="#f7f6f1"><path d="M31 17.33C25.33 13.07 16.67 12.53 10.67 14.13v33.07c6-1.6 14.67-1.07 20.33 3.2V17.33z"/><path d="M33 17.33c5.67-4.26 14.33-4.8 20.33-3.2v33.07c-6-1.6-14.67-1.07-20.33 3.2V17.33z"/></g></svg>`,
)}`;

/* Lomos de libro con los tonos de la plataforma, apoyados en un estante: sin
   el estante, las barras parecían un gráfico de crecimiento. */
const SPINES: Array<{ height: number; width: number; color: string; tilt?: number }> = [
  { height: 120, width: 26, color: "#9fd3b4" },
  { height: 176, width: 34, color: "#f7f6f1" },
  { height: 132, width: 22, color: "#d9c6a2" },
  { height: 196, width: 30, color: "#c97a5c" },
  // El último, ladeado: un estante con todos los lomos rectos se leía como un
  // gráfico de barras.
  { height: 150, width: 26, color: "#e6eee3", tilt: -9 },
];

/**
 * Tarjeta social por idioma, generada al vuelo con `next/og`.
 *
 * Se sirve como ruta de API (`/api/og/<idioma>`) y no con la convención
 * `opengraph-image.tsx` porque la convención produce una sola imagen por
 * segmento, y aquí hacen falta tres textos distintos que además tienen que
 * casar con el `og:title` del idioma que sirve el proxy.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const limited = ogRateLimit(request);
  if (limited) return limited;

  const { locale } = await params;
  const resolved = matchLocale(locale);
  if (!resolved) {
    // Un idioma que no existe no se inventa: mejor un 404 que cachear una
    // tarjeta en un idioma que nadie ha pedido.
    return new Response("Not found", { status: 404 });
  }
  const copy = {
    kicker: translate(resolved, OG_COPY.kicker),
    headline: translate(resolved, OG_COPY.headline),
    subline: translate(resolved, OG_COPY.subline),
    values: [
      translate(resolved, OG_COPY.valueNonProfit),
      translate(resolved, OG_COPY.valueOpenSource),
      translate(resolved, OG_COPY.valueNoAds),
    ],
  };

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "relative",
          background: "linear-gradient(135deg, #2f5741 0%, #24452f 100%)",
          color: "#f7f6f1",
          padding: "64px 72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* Satori solo entiende `img`; el SVG va incrustado arriba. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BOOK_ICON} alt="" width={58} height={58} style={{ borderRadius: 14 }} />
            <span style={{ fontSize: 31, fontWeight: 700, letterSpacing: -0.3 }}>
              Wanderbibliothek
            </span>
          </div>
          <span style={{ display: "flex", fontSize: 21, opacity: 0.75 }}>
            wanderbibliothek.org
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 780 }}>
          <span
            style={{
              display: "flex",
              fontSize: 18,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#d9c6a2",
            }}
          >
            {copy.kicker}
          </span>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.06,
              letterSpacing: -1,
            }}
          >
            {copy.headline}
          </div>
          <div style={{ display: "flex", fontSize: 29, lineHeight: 1.35, opacity: 0.88 }}>
            {copy.subline}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {copy.values.map((value) => (
            <span
              key={value}
              style={{
                display: "flex",
                padding: "8px 16px",
                border: "1px solid rgba(247, 246, 241, 0.35)",
                borderRadius: 999,
                fontSize: 20,
                opacity: 0.92,
              }}
            >
              {value}
            </span>
          ))}
        </div>

        <div
          style={{
            position: "absolute",
            right: 72,
            bottom: 120,
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            {SPINES.map((spine, index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  width: spine.width,
                  height: spine.height,
                  borderRadius: "4px 4px 0 0",
                  background: spine.color,
                  opacity: 0.92,
                  // Satori rechaza `transform: undefined`: solo se añade al lomo
                  // ladeado.
                  ...(spine.tilt
                    ? { transform: `rotate(${spine.tilt}deg)`, transformOrigin: "bottom center" }
                    : {}),
                }}
              />
            ))}
          </div>
          <div
            style={{
              display: "flex",
              height: 6,
              marginTop: 10,
              borderRadius: 3,
              background: "rgba(247, 246, 241, 0.3)",
            }}
          />
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );

  // La imagen solo cambia cuando cambia su código: se cachea un día en el CDN
  // y el navegador revalida, porque la URL no lleva versión.
  image.headers.set("Cache-Control", "public, max-age=0, s-maxage=86400");
  return image;
}
