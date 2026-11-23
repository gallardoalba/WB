import { sparklinePoints } from "@/lib/sparkline";

/**
 * Gráfico de línea mínimo, renderizado en el servidor.
 *
 * No es interactivo a propósito: el panel enseña tendencias, no sustituye a una
 * herramienta de análisis. `vectorEffect` mantiene el trazo fino al estirar el
 * SVG al ancho de la tarjeta.
 */
export function AdminSparkline({
  values,
  label,
}: {
  values: readonly (number | null)[];
  label: string;
}) {
  const points = sparklinePoints(values);
  return (
    <svg
      className="admin-sparkline"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {points ? (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
