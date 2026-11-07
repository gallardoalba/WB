import type { Metadata } from "next";
import { renderAppView, type AppViewPageProps } from "./app-view";
import { getLocale } from "@/lib/i18n-server";
import { alternatesFor } from "@/lib/seo";

// Depende de la sesión y de los filtros: se renderiza en el servidor por petición.
export const instant = false;

/**
 * Solo la portada declara canonical propio.
 *
 * Antes estaba en el layout y lo heredaban todas las páginas que no lo definían
 * (`/buscar`, `/ofrecer`, `/lectores`…): a ojos de Google eran duplicados de la
 * portada y quedaban fuera del índice. El `openGraph` se hereda del layout.
 */
export async function generateMetadata(): Promise<Metadata> {
  return { alternates: alternatesFor(await getLocale(), "/") };
}

export default async function Page({ searchParams }: AppViewPageProps) {
  // La portada acepta además `?view=x` para no romper enlaces antiguos.
  return renderAppView("home", await searchParams, "/");
}
