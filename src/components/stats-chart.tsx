import { sparklinePoints } from "@/lib/sparkline";

export type StatsChartTone =
  | "green"
  | "red"
  | "orange"
  | "blue"
  | "purple"
  | "yellow"
  | "cyan"
  | "neutral";

/**
 * Gráfico de área al estilo Grafana.
 *
 * Se dibuja en el servidor: una polilínea, un degradado y una rejilla. El tono
 * viaja como clase para que el SVG herede `currentColor` y no dependa de
 * JavaScript.
 */
export function StatsChart({
  id,
  values,
  label,
  tone = "green",
  compact = false,
  emptyLabel,
}: {
  id: string;
  values: readonly (number | null)[];
  label: string;
  tone?: StatsChartTone;
  compact?: boolean;
  emptyLabel: string;
}) {
  const width = 600;
  const height = compact ? 44 : 132;
  const points = sparklinePoints(values, width, height);

  if (!points) {
    return (
      <div
        className={`stats-chart stats-chart--empty stats-chart--${tone}${
          compact ? " stats-chart--compact" : ""
        }`}
      >
        <span>{emptyLabel}</span>
      </div>
    );
  }

  const coords = points.split(" ").map((pair) => pair.split(",").map(Number));
  const firstX = coords[0]?.[0] ?? 0;
  const lastX = coords[coords.length - 1]?.[0] ?? width;
  const area = `${points} ${lastX.toFixed(2)},${height} ${firstX.toFixed(2)},${height}`;
  const gradientId = `stats-gradient-${id}`;
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const average = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const averageY =
    max === min ? height / 2 : height - ((average - min) / (max - min)) * (height - 2) - 1;

  return (
    <div
      className={`stats-chart stats-chart--${tone}${compact ? " stats-chart--compact" : ""}`}
    >
      <svg
        className="stats-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.42" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {!compact ? (
          <g className="stats-chart-grid" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((step) => (
              <line
                key={`h-${step}`}
                x1="0"
                x2={width}
                y1={(height / 4) * step}
                y2={(height / 4) * step}
              />
            ))}
            {[0, 1, 2, 3, 4, 5].map((step) => (
              <line
                key={`v-${step}`}
                x1={(width / 6) * step}
                x2={(width / 6) * step}
                y1="0"
                y2={height}
              />
            ))}
          </g>
        ) : null}
        <polygon className="stats-chart-area" points={area} fill={`url(#${gradientId})`} />
        {!compact ? (
          <line
            className="stats-chart-average"
            x1="0"
            x2={width}
            y1={averageY}
            y2={averageY}
            aria-hidden="true"
          />
        ) : null}
        <polyline className="stats-chart-line-glow" points={points} fill="none" />
        <polyline className="stats-chart-line" points={points} fill="none" />
      </svg>
    </div>
  );
}

/**
 * Barras para el reparto de peticiones por hora o por día.
 *
 * Comparte la rejilla y el tono con las series de línea para que el panel no
 * parezca de otra herramienta.
 */
export function StatsBars({
  id,
  values,
  labels,
  tone = "green",
  label,
  emptyLabel,
}: {
  id: string;
  values: readonly number[];
  labels: readonly string[];
  tone?: StatsChartTone;
  label: string;
  emptyLabel: string;
}) {
  const width = 600;
  const height = 132;
  const gap = 3;
  const hasBars = values.some((value) => Number.isFinite(value) && value > 0);

  if (!hasBars) {
    return (
      <div className={`stats-bars stats-chart stats-chart--empty stats-chart--${tone}`}>
        <span>{emptyLabel}</span>
      </div>
    );
  }

  const max = Math.max(...values, 1);
  const barWidth = Math.max(1, (width - gap * (values.length - 1)) / values.length);

  return (
    <div className={`stats-bars stats-chart stats-chart--${tone}`}>
      <svg
        className="stats-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        <g className="stats-chart-grid" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((step) => (
            <line
              key={`h-${step}`}
              x1="0"
              x2={width}
              y1={(height / 4) * step}
              y2={(height / 4) * step}
            />
          ))}
        </g>
        {values.map((value, index) => {
          const barHeight = Math.max(1, (value / max) * (height - 4));
          return (
            <rect
              key={`${id}-${index}`}
              className="stats-bar"
              x={index * (barWidth + gap)}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx="1"
            >
              <title>{`${labels[index] ?? ""}: ${value}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="stats-bars-x" aria-hidden="true">
        {labels.map((label, index) => {
          const show =
            index === 0 ||
            index === labels.length - 1 ||
            index === Math.floor(labels.length / 2);
          return <span key={`${label}-${index}`}>{show ? label : ""}</span>;
        })}
      </div>
    </div>
  );
}
