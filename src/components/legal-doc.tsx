import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { translate } from "@/lib/i18n";
import type { LegalConfig, LegalDocument } from "@/lib/legal";
import { LocaleSwitcher } from "./locale-switcher";

/**
 * Marco de las páginas legales. Es público y no necesita sesión: tiene que
 * poder abrirse antes de crear la cuenta.
 */
export function LegalDoc({
  locale,
  document,
  config,
}: {
  locale: Locale;
  document: LegalDocument;
  config: LegalConfig;
}) {
  const t = (text: string) => translate(locale, text);
  return (
    <main className="page-shell">
      <div className="page-topbar">
        <Link className="back-link" href="/">
          <ArrowLeft size={16} /> {t("Inicio")}
        </Link>
        <LocaleSwitcher locale={locale} />
      </div>

      <article className="legal-doc">
        <h1>{document.title}</h1>
        <p className="legal-updated">
          {locale === "de" ? "Stand" : "Última actualización"}: {document.updated}
        </p>

        {!config.complete && (
          <p className="legal-warning" role="note">
            {locale === "de"
              ? "Diese Seite ist noch unvollständig: Die Daten des Verantwortlichen fehlen in der Dienstkonfiguration (LEGAL_CONTROLLER, LEGAL_ADDRESS, LEGAL_CONTACT_EMAIL)."
              : "Esta página está incompleta: faltan los datos del responsable en la configuración del servicio (LEGAL_CONTROLLER, LEGAL_ADDRESS, LEGAL_CONTACT_EMAIL)."}
          </p>
        )}

        {document.intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}

        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
