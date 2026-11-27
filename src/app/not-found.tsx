import Link from "next/link";
import { BookOpen } from "lucide-react";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { localePath } from "@/lib/locale";

export const instant = false;

export default async function NotFound() {
  const locale = await getLocale();
  const t = (text: string) => translate(locale, text);
  return (
    <main className="app-shell loading-shell">
      <div className="error-card">
        <span className="dialog-icon">
          <BookOpen size={20} />
        </span>
        <h1>{t("Esta página no existe")}</h1>
        <p>{t("Puede que el libro ya no esté disponible o que el enlace haya cambiado.")}</p>
        <div className="dialog-actions">
          <Link className="primary-button" href={localePath(locale, "/descubrir")}>
            {t("Volver al catálogo")}
          </Link>
        </div>
      </div>
    </main>
  );
}
