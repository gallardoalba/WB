import { renderAppView, type AppViewPageProps } from "../app-view";

export const instant = false;

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
