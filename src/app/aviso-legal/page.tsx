import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal-doc";
import { getLocale } from "@/lib/i18n-server";
import { alternatesFor } from "@/lib/seo";
import { translate } from "@/lib/i18n";
import { imprintDocument, legalConfig } from "@/lib/legal";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Aviso legal"),
    alternates: alternatesFor(locale, "/aviso-legal"),
  };
}

export default async function Page() {
  const locale = await getLocale();
  const config = legalConfig();
  return <LegalDoc locale={locale} document={imprintDocument(locale, config)} config={config} />;
}
