import { Search } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { Locale } from "@/lib/locale";

/**
 * Buscador global de la cabecera.
 *
 * Es un formulario GET normal (`/buscar?q=…`): funciona sin JavaScript, se puede
 * compartir por enlace y el botón «atrás» devuelve a los resultados anteriores.
 * Antes había que buscar dentro de cada sección por separado (catálogo, clubes,
 * lectores, listas) y no había ninguna entrada común en la parte de arriba.
 */
export function SiteSearch({
  locale,
  defaultValue = "",
}: {
  locale: Locale;
  defaultValue?: string;
}) {
  const t = (text: string) => translate(locale, text);
  return (
    <form className="site-search" action="/buscar" method="get" role="search">
      <Search size={15} aria-hidden className="site-search-icon" />
      <label className="sr-only" htmlFor="site-search-q">
        {t("Buscar en la comunidad")}
      </label>
      <input
        id="site-search-q"
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={t("Buscar libros, clubes, lectores…")}
        maxLength={60}
        autoComplete="off"
      />
      <button type="submit" className="site-search-submit">
        {t("Buscar")}
      </button>
    </form>
  );
}
