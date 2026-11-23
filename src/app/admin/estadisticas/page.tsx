import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  ChevronDown,
  Clock,
  Cpu,
  Database,
  Ellipsis,
  Gauge,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";

import { PageHeader, SiteShell } from "@/components/site-shell";
import {
  StatsBars,
  StatsChart,
  type StatsChartTone,
} from "@/components/stats-chart";
import { readBuildInfo } from "@/lib/build-info";
import { getLocale } from "@/lib/i18n-server";
import { translate } from "@/lib/i18n";
import { hostMetrics } from "@/lib/host-metrics";
import { localePath } from "@/lib/locale";
import {
  latestBackupAt,
  listRecentMetricsSamples,
  type MetricsSample,
} from "@/lib/metrics-history";
import { requirePageUser } from "@/lib/page-auth";
import { metricsValues } from "@/lib/prometheus";
import { getCommunityMetrics, getTotpState } from "@/lib/repo";

export const instant = false;

type RangeKey = "6h" | "24h" | "7d";

const RANGE_HOURS: Record<RangeKey, number> = { "6h": 6, "24h": 24, "7d": 168 };
const RANGE_LIMIT: Record<RangeKey, number> = { "6h": 300, "24h": 600, "7d": 1_200 };
const RANGE_LABEL: Record<RangeKey, string> = {
  "6h": "Últimas 6 horas",
  "24h": "Últimas 24 horas",
  "7d": "Últimos 7 días",
};

function parseRange(value: string | string[] | undefined): RangeKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "6h" || raw === "7d" ? raw : "24h";
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Estadísticas"),
    robots: { index: false, follow: false },
  };
}

type FormattedValue = { value: string; unit: string };

function formatBytesParts(
  value: number | null | undefined,
  locale: string,
): FormattedValue {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { value: "—", unit: "" };
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return {
    value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size),
    unit: units[unit]!,
  };
}

function formatBytes(value: number | null | undefined, locale: string): string {
  const formatted = formatBytesParts(value, locale);
  return formatted.unit ? `${formatted.value} ${formatted.unit}` : formatted.value;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatFixed(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMillisecondsParts(
  value: number | null,
  locale: string,
): FormattedValue {
  if (value === null) return { value: "—", unit: "" };
  return {
    value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value),
    unit: "ms",
  };
}

function formatMilliseconds(value: number | null, locale: string): string {
  const formatted = formatMillisecondsParts(value, locale);
  return formatted.unit ? `${formatted.value} ${formatted.unit}` : formatted.value;
}

function formatPercentParts(
  value: number | null,
  locale: string,
): FormattedValue {
  if (value === null) return { value: "—", unit: "" };
  return {
    value: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
      value * 100,
    ),
    unit: "%",
  };
}

function formatPercent(value: number | null, locale: string): string {
  const formatted = formatPercentParts(value, locale);
  return formatted.unit ? `${formatted.value} ${formatted.unit}` : formatted.value;
}

function formatDate(value: string | null, locale: string, empty: string): string {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? empty
    : date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}

function formatShortTime(
  value: string | undefined,
  locale: string,
  longRange: boolean,
): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return longRange
    ? date.toLocaleDateString(locale, { day: "2-digit", month: "short" })
    : date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function seriesOf(
  samples: readonly MetricsSample[],
  key: keyof MetricsSample,
): Array<number | null> {
  return samples.map((sample) => {
    const value = sample[key];
    return typeof value === "number" ? value : null;
  });
}

function deltasOf(
  samples: readonly MetricsSample[],
  key: "requests" | "errors",
): Array<number | null> {
  return samples.map((sample, index) => {
    if (index === 0) return null;
    const previous = samples[index - 1]![key];
    return Math.max(0, sample[key] - previous);
  });
}

type SeriesStats = {
  min: number;
  max: number;
  avg: number;
  last: number;
  count: number;
};

function seriesStats(values: readonly (number | null)[]): SeriesStats | null {
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (finite.length === 0) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const avg = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  return { min, max, avg, last: finite[finite.length - 1]!, count: finite.length };
}

type RequestBucket = { label: string; total: number };

function bucketRequests(
  samples: readonly MetricsSample[],
  values: readonly (number | null)[],
  byDay: boolean,
  locale: string,
): RequestBucket[] {
  const buckets = new Map<string, RequestBucket>();
  samples.forEach((sample, index) => {
    const delta = values[index];
    if (delta === null || !Number.isFinite(delta)) return;
    const date = new Date(sample.at);
    const key = byDay
      ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
    const label = byDay
      ? date.toLocaleDateString(locale, { day: "2-digit", month: "short" })
      : date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    const bucket = buckets.get(key) ?? { label, total: 0 };
    bucket.total += delta;
    buckets.set(key, bucket);
  });
  return [...buckets.values()];
}

function StatPanel({
  title,
  icon,
  value,
  unit,
  hint,
  gauge,
  series,
  tone = "neutral",
  span = 4,
  id,
  emptyLabel,
}: {
  title: string;
  icon?: ReactNode;
  value: string | number;
  unit?: string;
  hint?: string;
  gauge?: number | null;
  series?: readonly (number | null)[];
  tone?: StatsChartTone;
  span?: 3 | 4;
  id: string;
  emptyLabel: string;
}) {
  return (
    <article
      className={`stats-panel stats-stat-panel stats-panel--${tone} stats-col-${span}`}
    >
      <header className="stats-panel-head">
        <h3 className="stats-panel-title" title={title}>
          {icon}
          {title}
        </h3>
        <Ellipsis className="stats-panel-menu" size={14} aria-hidden="true" />
      </header>
      <div className="stats-stat-body">
        <div className="stats-stat-main">
          <strong className="stats-stat-value">{value}</strong>
          {unit ? <span className="stats-stat-unit">{unit}</span> : null}
        </div>
        {hint ? <span className="stats-stat-hint">{hint}</span> : null}
      </div>
      {gauge !== null && gauge !== undefined ? (
        <div className="stats-gauge" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, gauge))}%` }} />
        </div>
      ) : null}
      {series ? (
        <StatsChart
          id={id}
          values={series}
          label={title}
          tone={tone}
          compact
          emptyLabel={emptyLabel}
        />
      ) : null}
    </article>
  );
}

function TimeseriesPanel({
  title,
  icon,
  values,
  tone,
  id,
  format,
  from,
  mid,
  to,
  t,
  emptyLabel,
  wide = false,
}: {
  title: string;
  icon?: ReactNode;
  values: readonly (number | null)[];
  tone: StatsChartTone;
  id: string;
  format: (value: number) => string;
  from?: string;
  mid?: string;
  to?: string;
  t: (text: string) => string;
  emptyLabel: string;
  wide?: boolean;
}) {
  const stats = seriesStats(values);
  return (
    <article
      className={`stats-panel stats-timeseries stats-panel--${tone} ${
        wide ? "stats-col-12" : "stats-col-6"
      }`}
    >
      <header className="stats-panel-head">
        <h3 className="stats-panel-title" title={title}>
          {icon}
          {title}
        </h3>
        <span className="stats-panel-current">
          {stats ? format(stats.last) : "—"}
        </span>
      </header>
      <div className="stats-chart-body">
        {stats ? (
          <div className="stats-chart-y" aria-hidden="true">
            <span>{format(stats.max)}</span>
            <span>{format((stats.max + stats.min) / 2)}</span>
            <span>{format(stats.min)}</span>
          </div>
        ) : null}
        <div className="stats-chart-plot">
          <StatsChart
            id={id}
            values={values}
            label={title}
            tone={tone}
            emptyLabel={emptyLabel}
          />
          <div className="stats-chart-x" aria-hidden="true">
            <span>{from}</span>
            <span>{mid}</span>
            <span>{to}</span>
          </div>
        </div>
      </div>
      {stats ? (
        <div className="stats-chart-meta">
          <span className="stats-chart-stats">
            <span>
              {t("Mín.")} <b>{format(stats.min)}</b>
            </span>
            <span>
              {t("Media")} <b>{format(stats.avg)}</b>
            </span>
            <span>
              {t("Máx.")} <b>{format(stats.max)}</b>
            </span>
            <span>
              {t("Actual")} <b>{format(stats.last)}</b>
            </span>
          </span>
        </div>
      ) : null}
    </article>
  );
}

function StatsRow({ title, icon }: { title: string; icon?: ReactNode }) {
  return (
    <h2 className="stats-row">
      <span className="stats-row-title">
        <ChevronDown size={13} aria-hidden="true" />
        {icon}
        {title}
      </span>
      <span className="stats-row-line" aria-hidden="true" />
    </h2>
  );
}

export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const user = await requirePageUser("/admin/estadisticas");
  if (!user || !user.isAdmin) notFound();

  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) =>
    translate(locale, text, vars);
  const params = await searchParams;
  const range = parseRange(params.range);
  const refreshParam = Array.isArray(params.refresh)
    ? params.refresh[0]
    : params.refresh;
  const nextRefresh = refreshParam === "1" ? "0" : "1";
  const rangeLabel = t(RANGE_LABEL[range]);
  const emptyLabel = t("Sin datos");
  const basePath = localePath(locale, "/admin/estadisticas");

  if (process.env.NODE_ENV === "production" && !getTotpState(user.id).enabled) {
    return (
      <SiteShell user={user} section="admin-stats" title={t("Estadísticas")}>
        <PageHeader
          title={t("Estadísticas")}
          description={t("Estado del servidor y de la aplicación")}
        />
        <section className="admin-gate">
          <div className="admin-gate-head">
            <span className="admin-gate-icon" aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h2>{t("Falta un paso: verificación en dos pasos")}</h2>
              <p>
                {t(
                  "El panel no se abre hasta que tu cuenta tenga un segundo factor, porque desde aquí se mueven cuentas y contenido de otras personas.",
                )}
              </p>
            </div>
          </div>
          <h3>{t("Cómo activarla")}</h3>
          <ol className="admin-steps">
            <li>{t("Abre tu cuenta y despliega «Verificación en dos pasos».")}</li>
            <li>{t("Escanea el código QR con una aplicación de códigos (o guarda la clave).")}</li>
            <li>{t("Escribe el código de seis cifras que te muestre la aplicación.")}</li>
          </ol>
          <Link href={localePath(locale, "/cuenta")} className="primary-button small">
            {t("Ir a mi cuenta")}
          </Link>
        </section>
      </SiteShell>
    );
  }

  const values = metricsValues({ commit: readBuildInfo().commit });
  const host = hostMetrics();
  const community = getCommunityMetrics();
  const windowSamples = listRecentMetricsSamples(
    RANGE_HOURS[range],
    RANGE_LIMIT[range],
  );
  const samples7d =
    range === "7d" ? windowSamples : listRecentMetricsSamples(24 * 7, 1_000);
  const backupAt = latestBackupAt();

  const series = {
    requests: deltasOf(windowSamples, "requests"),
    errors: deltasOf(windowSamples, "errors"),
    requests7d: deltasOf(samples7d, "requests"),
    p95: seriesOf(windowSamples, "p95Ms"),
    rss: seriesOf(windowSamples, "rssBytes"),
    heap: seriesOf(windowSamples, "heapUsedBytes"),
    load: seriesOf(windowSamples, "load1"),
    cpu: seriesOf(windowSamples, "processCpuRatio"),
    wal: seriesOf(windowSamples, "walBytes"),
    disk: seriesOf(windowSamples, "diskFreeBytes"),
    db: seriesOf(windowSamples, "dbBytes"),
    freePages: seriesOf(windowSamples, "freePages"),
    jobs: seriesOf(windowSamples, "jobsPending"),
    delay: seriesOf(windowSamples, "jobsOverdueMinutes"),
    streams: seriesOf(windowSamples, "streams"),
  };

  const requestBuckets = bucketRequests(
    windowSamples,
    series.requests,
    range === "7d",
    locale,
  );
  const statusSamples = windowSamples.slice(-48);
  const statusErrors = deltasOf(statusSamples, "errors");

  const requestTotal = series.requests.reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0,
  );
  const errorTotal = series.errors.reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0,
  );
  const p95Last = seriesStats(series.p95)?.last ?? values.latency.p95;
  const streamsLast = seriesStats(series.streams)?.last ?? values.streams;

  const firstAt = windowSamples[0]?.at;
  const lastAt = windowSamples[windowSamples.length - 1]?.at;
  const from = formatShortTime(firstAt, locale, range === "7d");
  const to = formatShortTime(lastAt, locale, range === "7d");
  const from7d = formatShortTime(samples7d[0]?.at, locale, true);
  const mid7d = formatShortTime(
    samples7d[Math.floor(samples7d.length / 2)]?.at,
    locale,
    true,
  );
  const to7d = formatShortTime(
    samples7d[samples7d.length - 1]?.at,
    locale,
    true,
  );
  const mid = formatShortTime(
    windowSamples[Math.floor(windowSamples.length / 2)]?.at,
    locale,
    range === "7d",
  );

  const rss = formatBytesParts(values.rssBytes, locale);
  const heap = formatBytesParts(values.heapUsedBytes, locale);
  const disk = formatBytesParts(host.diskFreeBytes, locale);
  const db = formatBytesParts(values.dbBytes, locale);
  const wal = formatBytesParts(values.walBytes, locale);
  const p95 = formatMillisecondsParts(p95Last, locale);
  const cpu = formatPercentParts(host.processCpuRatio, locale);
  const uptime = formatDuration(values.uptimeSeconds);
  const backup = formatDate(backupAt, locale, t("Ninguna"));
  const newestSampleAt = windowSamples[windowSamples.length - 1]?.at;
  const diskUsedRatio =
    host.diskTotalBytes && host.diskTotalBytes > 0 && host.diskFreeBytes !== null
      ? Math.min(1, Math.max(0, 1 - host.diskFreeBytes / host.diskTotalBytes))
      : null;
  const loadRatio =
    host.load1 !== null && host.cpuCount > 0
      ? Math.min(1, Math.max(0, host.load1 / host.cpuCount))
      : null;
  const cpuRatio = host.processCpuRatio;
  const backupAgeHours =
    backupAt && newestSampleAt
      ? (Date.parse(newestSampleAt) - Date.parse(backupAt)) / 3_600_000
      : null;
  const p95Tone: StatsChartTone =
    p95Last === null
      ? "neutral"
      : p95Last > 1_000
        ? "red"
        : p95Last > 500
          ? "orange"
          : "green";
  const errorTone: StatsChartTone = errorTotal > 0 ? "red" : "green";
  const jobsTone: StatsChartTone =
    values.jobsFailed > 0
      ? "red"
      : values.jobsPending > 0
        ? "yellow"
        : "green";
  const delayTone: StatsChartTone =
    values.jobsOverdueMinutes > 60
      ? "red"
      : values.jobsOverdueMinutes > 0
        ? "orange"
        : "green";
  const diskTone: StatsChartTone =
    diskUsedRatio === null
      ? "cyan"
      : diskUsedRatio > 0.9
        ? "red"
        : diskUsedRatio > 0.75
          ? "orange"
          : "green";
  const loadTone: StatsChartTone =
    loadRatio === null
      ? "purple"
      : loadRatio > 0.9
        ? "red"
        : loadRatio > 0.7
          ? "orange"
          : "green";
  const cpuTone: StatsChartTone =
    cpuRatio === null
      ? "purple"
      : cpuRatio > 0.9
        ? "red"
        : cpuRatio > 0.7
          ? "orange"
          : "green";
  const backupTone: StatsChartTone =
    !backupAt
      ? "red"
      : backupAgeHours === null
        ? "neutral"
        : backupAgeHours > 168
          ? "red"
          : backupAgeHours > 48
            ? "orange"
            : "green";
  const healthTone: "green" | "orange" | "red" =
    values.jobsFailed > 0 ||
    (diskUsedRatio ?? 0) > 0.9 ||
    !backupAt ||
    (backupAgeHours !== null && backupAgeHours > 168)
      ? "red"
      : errorTotal > 0 ||
          (p95Last ?? 0) > 500 ||
          (diskUsedRatio ?? 0) > 0.75 ||
          (loadRatio ?? 0) > 0.9 ||
          (backupAgeHours !== null && backupAgeHours > 48)
        ? "orange"
        : "green";
  const healthLabel =
    healthTone === "green"
      ? t("Operativo")
      : healthTone === "orange"
        ? t("Atención")
        : t("Revisar");
  const recent = windowSamples.slice(-12).reverse();

  return (
    <SiteShell
      user={user}
      section="admin-stats"
      title={t("Estadísticas")}
      wide
    >
      <div className="stats-dashboard">
        <header className="stats-toolbar">
          <div className="stats-toolbar-title">
            <span className="stats-toolbar-eyebrow">{t("Administración")}</span>
            <h1>{t("Estadísticas")}</h1>
            <p>{t("Estado del servidor y de la aplicación")}</p>
          </div>
          <div className="stats-toolbar-actions">
            <span className={`stats-live stats-live--${healthTone}`}>
              <span className="stats-live-dot" aria-hidden="true" />
              {healthLabel}
            </span>
            <div className="stats-range" role="group" aria-label={t("Rango de tiempo")}>
              {(["6h", "24h", "7d"] as const).map((key) => (
                <Link
                  key={key}
                  className={range === key ? "stats-range-active" : undefined}
                  href={`${basePath}?range=${key}`}
                  aria-current={range === key ? "true" : undefined}
                >
                  {key === "6h" ? "6 h" : key === "24h" ? "24 h" : "7 d"}
                </Link>
              ))}
            </div>
            <Link
              className="stats-refresh"
              href={`${basePath}?range=${range}&refresh=${nextRefresh}`}
              aria-label={t("Actualizar")}
              title={t("Actualizar")}
            >
              <RefreshCw size={15} />
            </Link>
          </div>
        </header>

        <div className="stats-grid">
          <StatsRow title={t("Servidor")} icon={<Server size={13} aria-hidden="true" />} />
          <StatPanel
            title={t("Uptime")}
            icon={<Server size={13} aria-hidden="true" />}
            value={uptime}
            hint={`v${values.schemaVersion}`}
            tone="green"
            id="stat-uptime"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Memoria (RSS)")}
            icon={<MemoryStick size={13} aria-hidden="true" />}
            value={rss.value}
            unit={rss.unit}
            series={series.rss}
            tone="blue"
            id="stat-rss"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Carga (1 min)")}
            icon={<Cpu size={13} aria-hidden="true" />}
            value={host.load1 === null ? "—" : host.load1.toFixed(2)}
            hint={
              loadRatio === null
                ? `${host.cpuCount} CPU`
                : `${host.cpuCount} CPU · ${formatPercent(loadRatio, locale)}`
            }
            gauge={loadRatio === null ? null : loadRatio * 100}
            series={series.load}
            tone={loadTone}
            id="stat-load"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Disco libre")}
            icon={<HardDrive size={13} aria-hidden="true" />}
            value={disk.value}
            unit={disk.unit}
            hint={
              diskUsedRatio === null
                ? undefined
                : `${formatPercent(diskUsedRatio, locale)} ${t("usado")}`
            }
            gauge={diskUsedRatio === null ? null : diskUsedRatio * 100}
            series={series.disk}
            tone={diskTone}
            id="stat-disk"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Heap")}
            icon={<MemoryStick size={13} aria-hidden="true" />}
            value={heap.value}
            unit={heap.unit}
            series={series.heap}
            tone="blue"
            id="stat-heap"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("CPU")}
            icon={<Cpu size={13} aria-hidden="true" />}
            value={cpu.value}
            unit={cpu.unit}
            hint={`${host.cpuCount} CPU`}
            gauge={cpuRatio === null ? null : cpuRatio * 100}
            series={series.cpu}
            tone={cpuTone}
            id="stat-cpu"
            emptyLabel={emptyLabel}
          />

          <StatsRow title={t("Aplicación")} icon={<Activity size={13} aria-hidden="true" />} />
          <StatPanel
            title={t("Peticiones")}
            span={3}
            icon={<BarChart3 size={13} aria-hidden="true" />}
            value={formatNumber(requestTotal, locale)}
            hint={rangeLabel}
            series={series.requests}
            tone="green"
            id="stat-requests"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Errores")}
            span={3}
            icon={<TriangleAlert size={13} aria-hidden="true" />}
            value={formatNumber(errorTotal, locale)}
            hint={rangeLabel}
            series={series.errors}
            tone={errorTone}
            id="stat-errors"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Latencia p95")}
            span={3}
            icon={<Gauge size={13} aria-hidden="true" />}
            value={p95.value}
            unit={p95.unit}
            hint={rangeLabel}
            series={series.p95}
            tone={p95Tone}
            id="stat-p95"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Conexiones SSE")}
            span={3}
            icon={<Activity size={13} aria-hidden="true" />}
            value={formatNumber(streamsLast, locale)}
            hint={rangeLabel}
            series={series.streams}
            tone="blue"
            id="stat-sse"
            emptyLabel={emptyLabel}
          />

          <StatsRow title={t("Base de datos")} icon={<Database size={13} aria-hidden="true" />} />
          <StatPanel
            title={t("Tamaño de la BD")}
            icon={<Database size={13} aria-hidden="true" />}
            value={db.value}
            unit={db.unit}
            series={series.db}
            tone="blue"
            id="stat-db"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("WAL")}
            icon={<Database size={13} aria-hidden="true" />}
            value={wal.value}
            unit={wal.unit}
            series={series.wal}
            tone="yellow"
            id="stat-wal"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Páginas libres")}
            icon={<Database size={13} aria-hidden="true" />}
            value={formatNumber(values.freePages, locale)}
            series={series.freePages}
            tone="neutral"
            id="stat-free-pages"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Trabajos")}
            icon={<Clock size={13} aria-hidden="true" />}
            value={formatNumber(values.jobsPending, locale)}
            unit={t("Pendientes")}
            hint={`${t("En curso")}: ${values.jobsRunning} · ${t("Fallidos")}: ${values.jobsFailed}`}
            series={series.jobs}
            tone={jobsTone}
            id="stat-jobs"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Retraso máximo")}
            icon={<Clock size={13} aria-hidden="true" />}
            value={`${values.jobsOverdueMinutes} min`}
            series={series.delay}
            tone={delayTone}
            id="stat-delay"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Última copia")}
            icon={<HardDrive size={13} aria-hidden="true" />}
            value={backup}
            tone={backupTone}
            id="stat-backup"
            emptyLabel={emptyLabel}
          />

          <StatsRow title={t("Métricas de comunidad")} icon={<Users size={13} aria-hidden="true" />} />
          <StatPanel
            title={t("Conversaciones")}
            icon={<Users size={13} aria-hidden="true" />}
            value={formatNumber(community.conversations, locale)}
            tone="blue"
            id="stat-conversations"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Con actividad en su 2.ª semana")}
            icon={<Users size={13} aria-hidden="true" />}
            value={formatNumber(community.retention7d, locale)}
            tone="green"
            id="stat-retention"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Libros disponibles")}
            icon={<BarChart3 size={13} aria-hidden="true" />}
            value={formatNumber(community.availableListings, locale)}
            tone="green"
            id="stat-books"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Solicitudes (30 d)")}
            icon={<Activity size={13} aria-hidden="true" />}
            value={formatNumber(community.requests30d, locale)}
            tone="yellow"
            id="stat-requests-30d"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Completados (30 d)")}
            icon={<Activity size={13} aria-hidden="true" />}
            value={formatNumber(community.completed30d, locale)}
            tone="green"
            id="stat-completed-30d"
            emptyLabel={emptyLabel}
          />
          <StatPanel
            title={t("Completados por usuario activo (30 d)")}
            icon={<Gauge size={13} aria-hidden="true" />}
            value={
              community.activeUsers30d > 0
                ? (community.completed30d / community.activeUsers30d).toFixed(2)
                : "—"
            }
            tone="neutral"
            id="stat-completed-ratio"
            emptyLabel={emptyLabel}
          />

          <StatsRow title={t("Series temporales")} icon={<BarChart3 size={13} aria-hidden="true" />} />
          <TimeseriesPanel
            title={`${t("Peticiones")} · ${rangeLabel}`}
            icon={<BarChart3 size={13} aria-hidden="true" />}
            values={series.requests}
            tone="green"
            id="series-requests"
            format={(value) => formatNumber(value, locale)}
            from={from}
            mid={mid}
            to={to}
            t={t}
            emptyLabel={emptyLabel}
          />
          <TimeseriesPanel
            title={`${t("Errores")} · ${rangeLabel}`}
            icon={<TriangleAlert size={13} aria-hidden="true" />}
            values={series.errors}
            tone="red"
            id="series-errors"
            format={(value) => formatNumber(value, locale)}
            from={from}
            mid={mid}
            to={to}
            t={t}
            emptyLabel={emptyLabel}
          />
          <TimeseriesPanel
            title={`${t("Latencia p95")} · ${rangeLabel}`}
            icon={<Gauge size={13} aria-hidden="true" />}
            values={series.p95}
            tone="orange"
            id="series-p95"
            format={(value) => formatMilliseconds(value, locale)}
            from={from}
            mid={mid}
            to={to}
            t={t}
            emptyLabel={emptyLabel}
          />
          <TimeseriesPanel
            title={`${t("Memoria (RSS)")} · ${rangeLabel}`}
            icon={<MemoryStick size={13} aria-hidden="true" />}
            values={series.rss}
            tone="blue"
            id="series-rss"
            format={(value) => formatBytes(value, locale)}
            from={from}
            mid={mid}
            to={to}
            t={t}
            emptyLabel={emptyLabel}
          />
          <TimeseriesPanel
            title={`${t("Carga (1 min)")} · ${rangeLabel}`}
            icon={<Cpu size={13} aria-hidden="true" />}
            values={series.load}
            tone="purple"
            id="series-load"
            format={(value) => formatFixed(value, locale)}
            from={from}
            mid={mid}
            to={to}
            t={t}
            emptyLabel={emptyLabel}
          />
          <TimeseriesPanel
            title={`${t("WAL")} · ${rangeLabel}`}
            icon={<Database size={13} aria-hidden="true" />}
            values={series.wal}
            tone="yellow"
            id="series-wal"
            format={(value) => formatBytes(value, locale)}
            from={from}
            mid={mid}
            to={to}
            t={t}
            emptyLabel={emptyLabel}
          />
          <TimeseriesPanel
            title={`${t("Disco libre")} · ${rangeLabel}`}
            icon={<HardDrive size={13} aria-hidden="true" />}
            values={series.disk}
            tone="cyan"
            id="series-disk"
            format={(value) => formatBytes(value, locale)}
            from={from}
            mid={mid}
            to={to}
            t={t}
            emptyLabel={emptyLabel}
          />
          <TimeseriesPanel
            title={`${t("Tamaño de la BD")} · ${rangeLabel}`}
            icon={<Database size={13} aria-hidden="true" />}
            values={series.db}
            tone="blue"
            id="series-db"
            format={(value) => formatBytes(value, locale)}
            from={from}
            mid={mid}
            to={to}
            t={t}
            emptyLabel={emptyLabel}
          />
          <TimeseriesPanel
            title={`${t("Peticiones")} · ${t("Últimos 7 días")}`}
            icon={<BarChart3 size={13} aria-hidden="true" />}
            values={series.requests7d}
            tone="green"
            id="series-requests-7d"
            format={(value) => formatNumber(value, locale)}
            from={from7d}
            mid={mid7d}
            to={to7d}
            t={t}
            emptyLabel={emptyLabel}
            wide
          />

          <article className="stats-panel stats-bars-panel stats-panel--green stats-col-12">
            <header className="stats-panel-head">
              <h3 className="stats-panel-title">
                <BarChart3 size={13} aria-hidden="true" />
                {range === "7d"
                  ? t("Peticiones por día")
                  : t("Peticiones por hora")}
              </h3>
              <span className="stats-panel-current">
                {formatNumber(requestTotal, locale)}
              </span>
            </header>
            <StatsBars
              id="bars-requests"
              values={requestBuckets.map((bucket) => bucket.total)}
              labels={requestBuckets.map((bucket) => bucket.label)}
              label={
                range === "7d"
                  ? t("Peticiones por día")
                  : t("Peticiones por hora")
              }
              tone="green"
              emptyLabel={emptyLabel}
            />
          </article>

          <article className="stats-panel stats-status-panel stats-col-12">
            <header className="stats-panel-head">
              <h3 className="stats-panel-title">
                <Activity size={13} aria-hidden="true" />
                {t("Estado de las muestras")}
              </h3>
              <span className="stats-panel-sub">
                {statusSamples.length} {t("Filas")} · {t("Cada 15 minutos")}
              </span>
            </header>
            {statusSamples.length > 0 ? (
              <>
                <div className="stats-status-history">
                  {statusSamples.map((sample, index) => {
                    const errorDelta = statusErrors[index] ?? 0;
                    const tone: StatsChartTone =
                      sample.jobsFailed > 0 || errorDelta > 0
                        ? "red"
                        : (sample.p95Ms ?? 0) > 500
                          ? "orange"
                          : "green";
                    const description = `${formatDate(sample.at, locale, "—")} · ${t("Errores")}: ${errorDelta} · ${t("Latencia p95")}: ${formatMilliseconds(sample.p95Ms, locale)}`;
                    return (
                      <span
                        key={sample.at}
                        className={`stats-status-cell stats-status-cell--${tone}`}
                        role="img"
                        aria-label={description}
                        title={description}
                      />
                    );
                  })}
                </div>
                <div className="stats-status-legend">
                  <span>
                    <i
                      className="stats-status-dot stats-status-dot--green"
                      aria-hidden="true"
                    />
                    {t("Operativo")}
                  </span>
                  <span>
                    <i
                      className="stats-status-dot stats-status-dot--orange"
                      aria-hidden="true"
                    />
                    {t("Latencia p95")}
                  </span>
                  <span>
                    <i
                      className="stats-status-dot stats-status-dot--red"
                      aria-hidden="true"
                    />
                    {t("Errores")}
                  </span>
                </div>
              </>
            ) : (
              <p className="stats-empty">{emptyLabel}</p>
            )}
          </article>

          <article className="stats-panel stats-table-panel stats-col-12">
            <header className="stats-panel-head">
              <h3 className="stats-panel-title">
                <Clock size={13} aria-hidden="true" />
                {t("Muestras recientes")}
              </h3>
              <span className="stats-panel-sub">
                {recent.length} {t("Filas")} · {t("Cada 15 minutos")}
              </span>
            </header>
            {recent.length > 0 ? (
              <div className="stats-table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>{t("Hora")}</th>
                      <th>{t("Peticiones")}</th>
                      <th>{t("Errores")}</th>
                      <th>{t("Latencia p95")}</th>
                      <th>{t("WAL")}</th>
                      <th>{t("Fallidos")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((sample) => {
                      const p95Tone: StatsChartTone =
                        sample.p95Ms === null
                          ? "neutral"
                          : sample.p95Ms > 1_000
                            ? "red"
                            : sample.p95Ms > 500
                              ? "orange"
                              : "green";
                      return (
                        <tr key={sample.at}>
                          <td className="stats-table-time">
                            {formatDate(sample.at, locale, "—")}
                          </td>
                          <td>{formatNumber(sample.requests, locale)}</td>
                          <td>
                            <span
                              className={`stats-badge stats-badge--${
                                sample.errors > 0 ? "red" : "green"
                              }`}
                            >
                              {formatNumber(sample.errors, locale)}
                            </span>
                          </td>
                          <td>
                            <span className={`stats-badge stats-badge--${p95Tone}`}>
                              {formatMilliseconds(sample.p95Ms, locale)}
                            </span>
                          </td>
                          <td>{formatBytes(sample.walBytes, locale)}</td>
                          <td>
                            <span
                              className={`stats-badge stats-badge--${
                                sample.jobsFailed > 0 ? "red" : "green"
                              }`}
                            >
                              {formatNumber(sample.jobsFailed, locale)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="stats-empty">{emptyLabel}</p>
            )}
          </article>
        </div>
      </div>
    </SiteShell>
  );
}
