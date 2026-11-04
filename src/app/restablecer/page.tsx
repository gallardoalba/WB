import type { Metadata } from "next";
import { ResetPassword } from "@/components/reset-password";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";

// Depende de la URL: se renderiza por petición.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Nueva contraseña"),
    robots: { index: false, follow: false },
  };
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const raw = await searchParams;
  const token = typeof raw.token === "string" ? raw.token : "";
  return (
    <main className="page-shell">
      <ResetPassword token={token} />
    </main>
  );
}
