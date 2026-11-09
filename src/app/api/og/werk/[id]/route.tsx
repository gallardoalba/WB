import { ImageResponse } from "next/og";

import { imageDimensions } from "@/lib/cover-convert";
import { getCover, readUploadedCover } from "@/lib/covers";
import { OG_SIZE } from "@/lib/og";
import { ogRateLimit } from "@/lib/og-limit";
import { getPublicWork } from "@/lib/repo";

/* El mismo libro abierto del icono de la app, invertido: crema sobre el verde de
   la tarjeta, porque el verde del icono original se confunde con el fondo. */
const BOOK_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f7f6f1"/><g fill="#2f5741"><path d="M31 17.33C25.33 13.07 16.67 12.53 10.67 14.13v33.07c6-1.6 14.67-1.07 20.33 3.2V17.33z"/><path d="M33 17.33c5.67-4.26 14.33-4.8 20.33-3.2v33.07c-6-1.6-14.67-1.07-20.33 3.2V17.33z"/></g></svg>`,
)}`;

/** Alto de la portada dentro de la tarjeta; el ancho sale de su proporción. */
const COVER_HEIGHT = 520;
/** Tope de ancho: con una portada apaisada, el texto necesita su mitad. */
const COVER_MAX_WIDTH = 400;
/** Margen interior y separación entre portada y texto. */
const PADDING_X = 64;
const GAP = 52;
const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
/**
 * El margen vertical se deduce de la portada: así la marca arranca a la misma
 * altura que el borde superior del libro y el dominio acaba a la del inferior,
 * en vez de sobresalir por arriba y por abajo.
 */
const PADDING_Y = Math.round((CARD_HEIGHT - COVER_HEIGHT) / 2);

type CardCover = { src: string; width: number; height: number };

/**
 * Tarjeta social de una obra: la portada, enmarcada sobre el verde de la casa.
 *
 * Existe porque subir la portada tal cual a una red social deja una foto suelta
 * sobre blanco: pesa lo que pese el original y no dice de dónde viene. Aquí va
 * enmarcada, con la marca al lado, en 1200×630 —la proporción que Mastodon
 * muestra sin recortar y la misma de la tarjeta del sitio—.
 *
 * Se sirve en PNG y el bot la recompone a JPG antes de subirla: un PNG de
 * 1200×630 con una foto dentro pesa varias veces más que el JPG equivalente.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = ogRateLimit(request);
  if (limited) return limited;

  const { id } = await params;
  const work = getPublicWork(id);
  if (!work) return new Response("Not found", { status: 404 });

  const cover = await cardCover(work.id, work.isbn);
  const title = clamp(work.title, 90);
  const author = clamp(work.author, 64);
  // El ancho del texto se calcula en píxeles: con `flexGrow` a secas, Satori
  // deja crecer el bloque y un título largo se sale de la tarjeta.
  const textWidth = CARD_WIDTH - PADDING_X * 2 - GAP - (cover?.width ?? 0);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          // `stretch` para que la columna de texto ocupe todo el alto: con la
          // marca arriba y el dominio abajo, la mitad derecha no queda vacía.
          alignItems: "stretch",
          gap: GAP,
          background: "linear-gradient(135deg, #2f5741 0%, #24452f 100%)",
          color: "#f7f6f1",
          padding: `${PADDING_Y}px ${PADDING_X}px`,
          fontFamily: "sans-serif",
        }}
      >
        {cover ? (
          <div style={{ display: "flex", alignSelf: "center", flexShrink: 0 }}>
            {/* Satori solo entiende `img`; el SVG de la marca va incrustado arriba.
                Sin sombra: recorta `box-shadow` y no aplica `filter: blur`, así
                que el borde claro es lo que separa la portada del fondo. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover.src}
              alt=""
              width={cover.width}
              height={cover.height}
              style={{ borderRadius: 3, border: "1px solid rgba(247, 246, 241, 0.3)" }}
            />
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            // La marca arriba, la obra en el centro y el dominio abajo: así la
            // mitad derecha se lee de arriba abajo y no queda un hueco vacío
            // debajo de un título corto.
            justifyContent: "space-between",
            alignItems: "flex-start",
            textAlign: "left",
            width: textWidth,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BOOK_ICON} alt="" width={48} height={48} style={{ borderRadius: 12 }} />
            <span style={{ display: "flex", fontSize: 28, fontWeight: 700, letterSpacing: -0.2 }}>
              Wanderbibliothek
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 18,
              width: textWidth,
            }}
          >
            <div
              style={{
                display: "flex",
                width: textWidth,
                fontSize: 84,
                fontWeight: 700,
                lineHeight: 1.02,
                letterSpacing: -2,
                lineClamp: 3,
                textAlign: "left",
              }}
            >
              {title}
            </div>

            <div
              style={{
                display: "flex",
                fontSize: 38,
                lineHeight: 1.25,
                opacity: 0.88,
                textAlign: "left",
              }}
            >
              {author}
            </div>

            {/* Un filete corto: separa el texto del dominio y da peso al bloque. */}
            <div
              style={{
                display: "flex",
                width: 96,
                height: 3,
                marginTop: 4,
                background: "#d9c6a2",
                opacity: 0.9,
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 21,
              letterSpacing: 2.8,
              textTransform: "uppercase",
              color: "#d9c6a2",
            }}
          >
            wanderbibliothek.org
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      headers: {
        // La portada de una obra cambia poco: una hora de caché evita regenerar
        // la tarjeta cada vez que alguien abre el enlace.
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    },
  );
}

/** Corta por puntos de código un texto que no cabe en la tarjeta. */
function clamp(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * Portada de la obra con sus dimensiones finales, como `data:` para que Satori
 * no tenga que salir a la red. Se prefiere la subida a mano; si no hay, la del
 * ISBN (que queda en caché de disco, así que solo se paga la primera vez).
 */
async function cardCover(bookId: string, isbn: string | null): Promise<CardCover | null> {
  const uploaded = readUploadedCover(bookId);
  const cover = uploaded ?? (isbn ? await getCover(isbn).catch(() => null) : null);
  if (!cover) return null;
  const size = imageDimensions(cover.data);
  if (!size) return null;
  const scale = Math.min(COVER_HEIGHT / size.height, COVER_MAX_WIDTH / size.width);
  return {
    src: `data:${cover.contentType};base64,${cover.data.toString("base64")}`,
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  };
}
