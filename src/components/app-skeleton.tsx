import { getLocale } from "@/lib/i18n-server";
import { translate } from "@/lib/i18n";
import { PageSkeleton } from "./page-skeleton";

/**
 * Esqueleto del armazón completo (barra lateral + panel) para las rutas cuyo
 * contenido llega después: catálogo, estantería, intercambios, comunidad y las
 * páginas internas.
 *
 * Sin él, pulsar «Descubrir» no daba ninguna señal hasta que llegaba el HTML:
 * con `cacheComponents` la estructura podría responderse antes, pero mientras
 * la vista es cliente no hay nada que enseñar.
 */
export async function AppSkeleton({ rows = 4 }: { rows?: number }) {
  const locale = await getLocale();
  const t = (text: string) => translate(locale, text);

  return (
    <main className="app-shell" aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">
        {t("Cargando…")}
      </span>
      <div className="rail-skeleton" aria-hidden="true">
        <div className="skeleton-block rail-skeleton-brand" />
        <div className="skeleton-block rail-skeleton-item" />
        <div className="skeleton-block rail-skeleton-item" />
        <div className="skeleton-block rail-skeleton-item" />
        <div className="skeleton-block rail-skeleton-user" />
      </div>
      <section className="main-panel">
        <PageSkeleton rows={rows} label={t("Cargando…")} />
      </section>
    </main>
  );
}
