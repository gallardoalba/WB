import type { Metadata } from "next";
import Link from "next/link";
import { AppealForm } from "@/components/appeal-form";
import { peekAccountToken } from "@/lib/account-tokens";
import { appealTexts } from "@/lib/appeal-text";
import { getLocale } from "@/lib/i18n-server";

// Depende de la URL y de la base: se renderiza por petición.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: appealTexts(locale).title,
    robots: { index: false, follow: false },
  };
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const raw = await searchParams;
  const token = typeof raw.token === "string" ? raw.token : "";
  const valid =
    /^[a-f0-9]{64}$/.test(token) && Boolean(peekAccountToken(token, "appeal"));
  const texts = appealTexts(await getLocale());

  return (
    <main className="page-shell">
      {valid ? (
        <AppealForm token={token} texts={texts} />
      ) : (
        <div className="empty-state">
          <h1>{texts.invalidTitle}</h1>
          <p>{texts.invalidBody}</p>
          <Link className="secondary-button small" href="/">
            {texts.back}
          </Link>
        </div>
      )}
    </main>
  );
}
