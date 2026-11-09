"use client";

import Image from "next/image";
import { useState } from "react";
import { toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";

type BookCoverProps = {
  id: string;
  title: string;
  /** Autoría: se imprime en la portada de reserva, como en una portadilla. */
  author?: string;
  coverUrl: string | null;
  sizes?: string;
  /** La portada es el LCP de la página (ficha): se pide sin diferir. */
  priority?: boolean;
};

/**
 * Portada de reserva con el título completo y la autoría.
 *
 * La tarjeta no tiene imagen para muchos ISBN, así que el hueco se resuelve
 * como una portadilla escrita a mano: título entero —sin recortar— compuesto
 * en caligrafía, un filete y la firma de quien lo escribió. El tamaño baja en
 * tres pasos según lo largo que sea el título, que es más fiable que confiar en
 * que quepa.
 */
function titleTier(title: string): string {
  if (title.length > 72) return "is-xlong";
  if (title.length > 44) return "is-long";
  if (title.length > 26) return "is-medium";
  return "";
}

export function BookCover({
  id,
  title,
  author,
  coverUrl,
  sizes = "(max-width: 700px) 44vw, 220px",
  priority = false,
}: BookCoverProps) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // La portada impresa se pinta SIEMPRE debajo de la imagen: así la tarjeta no
  // enseña un hueco mientras la descarga va y, si el proveedor falla, el
  // resultado ya está en su sitio. Va `aria-hidden` porque el título y la
  // autoría ya se anuncian en la tarjeta; repetirlos aquí sería ruido.
  const fallback = (
    <div
      className={`cover-fallback tone-${toneForId(id)} ${titleTier(title)}`}
      aria-hidden="true"
    >
      <span className="cover-title">{title}</span>
      <span className="cover-rule" />
      {author && <span className="cover-author">{author}</span>}
    </div>
  );

  // Sin imagen, o con una imagen que no vale: solo la portadilla.
  if (!coverUrl || failed) return fallback;

  return (
    <>
      {/* La portadilla hace de hueco mientras la imagen llega; en cuanto la
          imagen está puesta se retira, porque hay portadas con fondo
          transparente y el texto se vería a través. */}
      {!loaded && fallback}
      <Image
      src={coverUrl}
      alt={t("Portada de {title}", { title })}
      fill
      sizes={sizes}
      unoptimized
      priority={priority}
      // La portada la sirve la propia aplicación (`/api/cover/<isbn>`), que la
      // descarga y la cachea en el servidor: el navegador no habla con ningún
      // tercero y no revela el ISBN de lo que está mirando.
      referrerPolicy="no-referrer"
      className="cover-image"
      // Si el 404 llega antes de que React enganche `onError` (la imagen viene
      // en el HTML del servidor), el evento se pierde y el navegador pinta su
      // icono de imagen rota encima de la portadilla. Al montar se mira el
      // estado real de la imagen y se retira igualmente.
      ref={(node) => {
        if (node && node.complete && node.naturalWidth === 0) setFailed(true);
      }}
      onError={() => setFailed(true)}
      onLoad={(event) => {
        // El proveedor responde 200 con una imagen 1×1 cuando no tiene portada.
        const image = event.currentTarget;
        if (image.naturalWidth < 20 || image.naturalHeight < 30) setFailed(true);
        else setLoaded(true);
      }}
      />
    </>
  );
}
