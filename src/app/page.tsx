import { Suspense } from "react";
import type { Metadata } from "next";
import { renderAppView, type AppViewPageProps } from "./app-view";
import { AppSkeleton } from "@/components/app-skeleton";
import { getLocale } from "@/lib/i18n-server";
import { alternatesFor } from "@/lib/seo";

// La portada depende de la sesión y de los filtros: no se prerenderiza entera.
// Lo que sí llega en el primer HTML es el armazón con la forma del héroe (ver
// `Page`); el contenido se transmite en cuanto la base responde.
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
  return (
    <Suspense fallback={<AppSkeleton rows={4} hero />}>
      <HomeView params={searchParams} />
    </Suspense>
  );
}

/**
 * La vista se lee dentro de la frontera de `Suspense` y no en `Page`: así la
 * primera respuesta puede llevar ya el armazón (barra lateral, hueco del héroe
 * y rejilla) mientras la base devuelve la sesión y el catálogo, en lugar de
 * dejar la pantalla en blanco hasta tenerlo todo.
 *
 * La frontera va aquí, en la portada, y **no** como `loading.tsx` del segmento
 * raíz: ese `loading` lo heredarían `/documentacion`, `/privacidad`,
 * `/projekt`… y les pintaría un esqueleto de catálogo que no tiene nada que ver
 * con lo que van a recibir.
 */
async function HomeView({ params }: { params: AppViewPageProps["searchParams"] }) {
  // La portada acepta además `?view=x` para no romper enlaces antiguos.
  return renderAppView("home", await params, "/");
}
