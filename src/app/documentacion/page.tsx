import type { Metadata } from "next";
import { TechnicalDoc } from "@/components/technical-doc";
import { getLocale } from "@/lib/i18n-server";
import { alternatesFor } from "@/lib/seo";
import { translate } from "@/lib/i18n";
import { technicalDocument } from "@/lib/technical";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Documentación técnica"),
    description: translate(
      locale,
      "Arquitectura, rutas, datos, seguridad y operación de Wanderbibliothek.",
    ),
    alternates: alternatesFor(locale, "/documentacion"),
  };
}

export default async function Page() {
  const locale = await getLocale();
  return <TechnicalDoc locale={locale} document={technicalDocument(locale)} />;
}
