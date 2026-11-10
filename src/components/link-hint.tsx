"use client";

import { useLinkStatus } from "next/link";

/**
 * Barra fina que corre por debajo del enlace mientras la ruta destino carga.
 *
 * Solo funciona dentro de un `<Link>` de `next/link` y solo se ve cuando la
 * navegación no estaba ya prefetchada. Se pinta absoluta y de 2 px para no
 * mover el texto: un indicador en línea provocaría justo el salto de
 * maquetación que se quiere evitar.
 */
export function LinkHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={pending ? "link-hint is-pending" : "link-hint"}
    />
  );
}
