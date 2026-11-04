import { renderAppView, type AppViewPageProps } from "./app-view";

// Depende de la sesión y de los filtros: se renderiza en el servidor por petición.
export const instant = false;

export default async function Page({ searchParams }: AppViewPageProps) {
  // La portada acepta además `?view=x` para no romper enlaces antiguos.
  return renderAppView("home", await searchParams, "/");
}
