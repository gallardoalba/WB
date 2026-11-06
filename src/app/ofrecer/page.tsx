import type { Metadata } from "next";
import { renderAppView, type AppViewPageProps } from "../app-view";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";

export const instant = false;

/**
 * Formulario de publicación: útil para quien ya tiene cuenta, ruido para un
 * buscador (sin sesión solo hay una redirección al acceso). Se rastrea el
 * enlace pero no se indexa.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Ofrecer un libro"),
    robots: { index: false, follow: false },
  };
}

/**
 * Publicar un libro, en su propia página.
 *
 * Antes era una ventana emergente: no tenía URL, no se podía enlazar ni
 * recargar sin perder lo escrito y no dejaba volver con el botón «atrás».
 * Ahora es una vista más del shell (con su barra lateral y su cabecera) y el
 * formulario vive en su propia ruta.
 */
export default async function Page({ searchParams }: AppViewPageProps) {
  return renderAppView("offer", await searchParams, "/ofrecer");
}
