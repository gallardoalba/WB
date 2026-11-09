"use client";

import Image from "next/image";
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";

type BookCoverProps = {
  id: string;
  title: string;
  coverUrl: string | null;
  sizes?: string;
  /** La portada es el LCP de la página (ficha): se pide sin diferir. */
  priority?: boolean;
};

export function BookCover({
  id,
  title,
  coverUrl,
  sizes = "(max-width: 700px) 44vw, 220px",
  priority = false,
}: BookCoverProps) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Hueco neutro mientras llega la imagen, y también cuando no hay: la portada
  // es un dato obligatorio del alta, así que aquí solo se cae si la subida
  // falló o si la ficha es anterior a esa regla. Antes se componía una
  // portadilla con el título, que disimulaba la falta de imagen y hacía creer
  // que el libro «tenía» portada.
  const fallback = (
    <div className={`cover-fallback is-empty tone-${toneForId(id)}`} aria-hidden="true">
      <BookOpen size={30} strokeWidth={1.4} />
    </div>
  );

  // Sin imagen, o con una imagen que no vale: solo el hueco.
  if (!coverUrl || failed) return fallback;

  return (
    <>
      {/* El hueco se retira en cuanto la imagen está puesta: hay portadas con
          fondo transparente y se vería la silueta detrás. */}
      {!loaded && fallback}
      <Image
      src={coverUrl}
      alt={t("Portada de {title}", { title })}
      fill
      sizes={sizes}
      unoptimized
      priority={priority}
      // La portada la sirve la propia aplicación (`/api/cover/book/<id>`), que
      // la lee del disco: el navegador no habla con ningún tercero.
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
