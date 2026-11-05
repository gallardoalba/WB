import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal-doc";
import { getLocale } from "@/lib/i18n-server";
import { translate } from "@/lib/i18n";
import { legalConfig, privacyDocument } from "@/lib/legal";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Privacidad"),
    description: translate(
      locale,
      "Qué datos trata Wanderbibliothek, durante cuánto tiempo y con quién se comparten.",
    ),
    alternates: { canonical: "/privacidad" },
  };
}

export default async function Page() {
  const locale = await getLocale();
  const config = legalConfig();
  return <LegalDoc locale={locale} document={privacyDocument(locale, config)} config={config} />;
}
