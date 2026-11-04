import type { Metadata } from "next";
import { AccountSettings } from "@/components/account-settings";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { requirePageUser } from "@/lib/page-auth";
import { allowPageView } from "@/lib/page-throttle";
import { countOwnListings, listAvailabilityAlerts, listRequests } from "@/lib/repo";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Cuenta"),
    description: translate(
      locale,
      "Datos de tu cuenta: perfil, contraseña, avisos y cifrado de mensajes.",
    ),
    alternates: { canonical: "/cuenta" },
    robots: { index: false, follow: false },
  };
}

/**
 * La cuenta tiene página propia: son formularios largos (perfil, contraseña,
 * verificación en dos pasos, cifrado, borrado) que no caben bien en un diálogo
 * y que conviene poder enlazar y recargar.
 */
export default async function Page() {
  const user = await requirePageUser("/cuenta");
  const locale = await getLocale();
  const t = (text: string) => translate(locale, text);

  if (!(await allowPageView(120, 60_000, user.id))) {
    return (
      <SiteShell user={user} section="perfil" title={t("Cuenta")}>
        <div className="page-shell">
          <h1>{t("Demasiadas peticiones")}</h1>
          <p className="empty-note">{t("Espera un minuto antes de volver a cargar la cuenta.")}</p>
          <a href="/cuenta" className="secondary-button small">
            {t("Reintentar")}
          </a>
        </div>
      </SiteShell>
    );
  }

  const requests = listRequests(user.id);
  const published = countOwnListings(user.id);
  const alertsOn = listAvailabilityAlerts(user.id).includes(user.city);

  return (
    <SiteShell user={user} section="perfil" title={t("Cuenta")}>
      <PageHeader
        title={user.name}
        description={user.bio || t("Sin biografía todavía.")}
      />
      <AccountSettings
        user={user}
        requests={requests}
        publishedCount={published}
        alertsOn={alertsOn}
      />
    </SiteShell>
  );
}
