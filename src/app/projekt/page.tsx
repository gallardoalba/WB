import type { Metadata } from "next";
import { TechnicalDoc } from "@/components/technical-doc";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { legalConfig } from "@/lib/legal";
import { projectDocument } from "@/lib/project";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "El proyecto"),
    description: translate(
      locale,
      "Qué es Wanderbibliothek, por qué existe y qué hay detrás: un proyecto comunitario sin ánimo de lucro, con el código abierto y la privacidad como decisiones de diseño.",
    ),
    alternates: { canonical: "/projekt" },
  };
}

/**
 * «Über das Projekt»: la página que explica el sitio a quien llega desde fuera.
 *
 * Comparte renderizador y estilos con la documentación técnica, pero habla del
 * proyecto, no del código: qué es, por qué existe, que no tiene ánimo de lucro
 * y qué demuestra.
 */
export default async function Page() {
  const locale = await getLocale();
  const { contact } = legalConfig();
  return <TechnicalDoc locale={locale} document={projectDocument(locale, contact)} />;
}
