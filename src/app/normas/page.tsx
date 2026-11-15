import type { Metadata } from "next";
import { TechnicalDoc } from "@/components/technical-doc";
import { governanceDocument } from "@/lib/governance";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { alternatesFor } from "@/lib/seo";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Normas"),
    description: translate(
      locale,
      "Cómo se gobierna una instancia de Wanderbibliothek, cómo se modera, cómo se sanciona y cómo se apela una sanción.",
    ),
    alternates: alternatesFor(locale, "/normas"),
  };
}

/** Reglas de convivencia y gobernanza: la página pública de /projekt enlaza aquí. */
export default async function Page() {
  const locale = await getLocale();
  return <TechnicalDoc locale={locale} document={governanceDocument(locale)} />;
}
