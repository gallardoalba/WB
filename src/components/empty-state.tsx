import type { ReactNode } from "react";

/**
 * Estado vacío con una sola forma en toda la plataforma.
 *
 * Había tres maneras de decir «aquí no hay nada»: `.empty-state` (icono, título
 * y pista), `.empty-results` (solo en el catálogo) y `.empty-note` (una línea
 * suelta). Ahora todas salen de aquí, así que el hueco, el icono y el tono son
 * los mismos en estantería, intercambios, moderación, listas y clubes.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

/** Variante de una línea, para huecos pequeños (un selector, un préstamo). */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="empty-note">{children}</p>;
}
