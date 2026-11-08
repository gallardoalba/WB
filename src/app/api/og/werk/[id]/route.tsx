import { ImageResponse } from "next/og";

import { imageDimensions } from "@/lib/cover-convert";
import { getCover, readUploadedCover } from "@/lib/covers";
import { OG_SIZE } from "@/lib/og";
import { getPublicWork } from "@/lib/repo";

/* El mismo libro abierto del icono de la app, incrustado como SVG: Satori no
   tiene las fuentes ni los recursos del sitio, así que la marca viaja dentro de
   la propia imagen. */
const BOOK_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2f5741"/><g fill="#f7f6f1"><path d="M31 17.33C25.33 13.07 16.67 12.53 10.67 14.13v33.07c6-1.6 14.67-1.07 20.33 3.2V17.33z"/><path d="M33 17.33c5.67-4.26 14.33-4.8 20.33-3.2v33.07c-6-1.6-14.67-1.07-20.33 3.2V17.33z"/></g></svg>`,
)}`;

/** Alto de la portada dentro de la tarjeta; el ancho sale de su proporción. */
const COVER_HEIGHT = 480;
/** Tope de ancho: el texto necesita su mitad de la tarjeta. */
const COVER_MAX_WIDTH = 330;

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
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = getPublicWork(id);
  if (!work) return new Response("Not found", { status: 404 });

  const cover = await cardCover(work.id, work.isbn);
  const title = clamp(work.title, 90);
  const author = clamp(work.author, 64);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 56,
          background: "linear-gradient(135deg, #2f5741 0%, #24452f 100%)",
          color: "#f7f6f1",
          padding: "64px 72px",
          fontFamily: "sans-serif",
        }}
      >
        {cover ? (
          <div style={{ display: "flex", position: "relative", flexShrink: 0 }}>
            {/* Sombra falsa: Satori no admite `box-shadow` con garantías, y una
                placa oscura desplazada da el mismo volumen. */}
            <div
              style={{
                position: "absolute",
                left: 18,
                top: 18,
                width: cover.width,
                height: cover.height,
                display: "flex",
                background: "rgba(12, 24, 18, 0.34)",
                borderRadius: 4,
              }}
            />
            {/* Satori solo entiende `img`; el SVG va incrustado arriba. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover.src}
              alt=""
              width={cover.width}
              height={cover.height}
              style={{ borderRadius: 4, border: "1px solid rgba(247, 246, 241, 0.28)" }}
            />
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 18,
            flexGrow: 1,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BOOK_ICON} alt="" width={44} height={44} style={{ borderRadius: 11 }} />
            <span style={{ display: "flex", fontSize: 25, fontWeight: 700, letterSpacing: -0.2 }}>
              Wanderbibliothek
            </span>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 56,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: -1.2,
              lineClamp: 4,
            }}
          >
            {title}
          </div>

          <div style={{ display: "flex", fontSize: 29, lineHeight: 1.3, opacity: 0.86 }}>
            {author}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 6,
              fontSize: 19,
              letterSpacing: 2.4,
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
