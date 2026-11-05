/**
 * Esqueleto de carga para las rutas cuyo contenido llega después del shell.
 *
 * Con `cacheComponents` la estructura de la página se sirve al instante; esto
 * ocupa el hueco del contenido mientras llega: sin él, en una conexión lenta el
 * clic no da ninguna señal.
 *
 * `aria-busy` + texto solo para lectores de pantalla: quien usa un lector sabe
 * que está cargando, y quien ve la pantalla ve el esqueleto.
 */
export function PageSkeleton({ rows = 3, label }: { rows?: number; label?: string }) {
  return (
    <div className="page-skeleton" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label ?? "Cargando…"}</span>
      <div className="skeleton-block skeleton-title" aria-hidden="true" />
      <div className="skeleton-block skeleton-subtitle" aria-hidden="true" />
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="skeleton-block skeleton-card" />
        ))}
      </div>
    </div>
  );
}
