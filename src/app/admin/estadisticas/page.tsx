import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { AdminSparkline } from "@/components/admin-sparkline";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { readBuildInfo } from "@/lib/build-info";
import { getLocale } from "@/lib/i18n-server";
import { translate } from "@/lib/i18n";
import { hostMetrics } from "@/lib/host-metrics";
import {
  latestBackupAt,
  listRecentMetricsSamples,
  type MetricsSample,
} from "@/lib/metrics-history";
import { requirePageUser } from "@/lib/page-auth";
import { metricsValues } from "@/lib/prometheus";
import { getCommunityMetrics, getTotpState } from "@/lib/repo";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Estadísticas"),
    robots: { index: false, follow: false },
  };
}

function formatBytes(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size);
  return `${formatted} ${units[unit]}`;
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

function formatMilliseconds(value: number | null, locale: string): string {
  if (value === null) return "—";
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  return `${formatted} ms`;
}

function formatPercent(value: number | null, locale: string): string {
  if (value === null) return "—";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value * 100)} %`;
}

function formatDate(value: string | null, locale: string, empty: string): string {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? empty
    : date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
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

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {hint ? <small>{hint}</small> : null}
      </dd>
    </div>
  );
}

export default async function StatisticsPage() {
  await connection();
  const user = await requirePageUser("/admin/estadisticas");
  if (!user || !user.isAdmin) notFound();

  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) =>
    translate(locale, text, vars);

  if (process.env.NODE_ENV === "production" && !getTotpState(user.id).enabled) {
    return (
      <SiteShell user={user} section="admin" title={t("Estadísticas")}>
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
          <Link href="/cuenta" className="primary-button small">
            {t("Ir a mi cuenta")}
          </Link>
        </section>
      </SiteShell>
    );
  }

  const values = metricsValues({ commit: readBuildInfo().commit });
  const host = hostMetrics();
  const community = getCommunityMetrics();
  const samples24h = listRecentMetricsSamples(24, 200);
  const samples7d = listRecentMetricsSamples(24 * 7, 1_000);
  const backupAt = latestBackupAt();

  const charts = [
    {
      label: `${t("Peticiones")} · ${t("Últimas 24 horas")}`,
      values: deltasOf(samples24h, "requests"),
    },
    {
      label: `${t("Errores")} · ${t("Últimas 24 horas")}`,
      values: deltasOf(samples24h, "errors"),
    },
    {
      label: `${t("Latencia p95")} · ${t("Últimas 24 horas")}`,
      values: seriesOf(samples24h, "p95Ms"),
    },
    {
      label: `${t("Memoria (RSS)")} · ${t("Últimas 24 horas")}`,
      values: seriesOf(samples24h, "rssBytes"),
    },
    {
      label: `${t("WAL")} · ${t("Últimas 24 horas")}`,
      values: seriesOf(samples24h, "walBytes"),
    },
    {
      label: `${t("Disco libre")} · ${t("Últimas 24 horas")}`,
      values: seriesOf(samples24h, "diskFreeBytes"),
    },
    {
      label: `${t("Peticiones")} · ${t("Últimos 7 días")}`,
      values: deltasOf(samples7d, "requests"),
    },
  ];

  const recent = samples24h.slice(-10).reverse();

  return (
    <SiteShell user={user} section="admin" title={t("Estadísticas")}>
      <PageHeader
        title={t("Estadísticas")}
        description={t("Estado del servidor y de la aplicación")}
        aside={<span className="shelf-count">{t("Operativo")}</span>}
      />

      <p className="admin-nav">
        <Link className="text-link" href="/admin">
          {t("Volver a moderación")}
        </Link>
      </p>

      <div className="admin-sections">
        <section aria-labelledby="stats-server">
          <h2 className="admin-title" id="stats-server">
            {t("Servidor")}
          </h2>
          <dl className="aside-stats admin-stat-grid">
            <Stat label={t("Uptime")} value={formatDuration(values.uptimeSeconds)} />
            <Stat label={t("Memoria (RSS)")} value={formatBytes(values.rssBytes, locale)} />
            <Stat label={t("Heap")} value={formatBytes(values.heapUsedBytes, locale)} />
            <Stat
              label={t("Carga (1 min)")}
              value={host.load1 === null ? "—" : host.load1.toFixed(2)}
              hint={`${host.cpuCount} CPU`}
            />
            <Stat label={t("Disco libre")} value={formatBytes(host.diskFreeBytes, locale)} />
            <Stat label="CPU" value={formatPercent(host.processCpuRatio, locale)} />
          </dl>
        </section>

        <section aria-labelledby="stats-app">
          <h2 className="admin-title" id="stats-app">
            {t("Aplicación")}
          </h2>
          <dl className="aside-stats admin-stat-grid">
            <Stat label={t("Peticiones")} value={formatNumber(values.requests, locale)} />
            <Stat label={t("Errores")} value={formatNumber(values.errors, locale)} />
            <Stat label={t("Latencia p95")} value={formatMilliseconds(values.latency.p95, locale)} />
            <Stat label={t("Conexiones SSE")} value={formatNumber(values.streams, locale)} />
          </dl>
        </section>

        <section aria-labelledby="stats-db">
          <h2 className="admin-title" id="stats-db">
            {t("Base de datos")}
          </h2>
          <dl className="aside-stats admin-stat-grid">
            <Stat label={t("Tamaño de la BD")} value={formatBytes(values.dbBytes, locale)} />
            <Stat label={t("WAL")} value={formatBytes(values.walBytes, locale)} />
            <Stat label={t("Páginas libres")} value={formatNumber(values.freePages, locale)} />
            <Stat
              label={t("Trabajos")}
              value={`${t("Pendientes")}: ${values.jobsPending} · ${t("En curso")}: ${values.jobsRunning} · ${t("Fallidos")}: ${values.jobsFailed}`}
            />
            <Stat label={t("Retraso máximo")} value={`${values.jobsOverdueMinutes} min`} />
            <Stat label={t("Última copia")} value={formatDate(backupAt, locale, t("Ninguna"))} />
          </dl>
        </section>

        <section aria-labelledby="stats-community">
          <h2 className="admin-title" id="stats-community">
            {t("Métricas de comunidad")}
          </h2>
          <dl className="aside-stats admin-stat-grid">
            <Stat label={t("Conversaciones")} value={formatNumber(community.conversations, locale)} />
            <Stat
              label={t("Con actividad en su 2.ª semana")}
              value={formatNumber(community.retention7d, locale)}
            />
            <Stat
              label={t("Libros disponibles")}
              value={formatNumber(community.availableListings, locale)}
            />
            <Stat label={t("Solicitudes (30 d)")} value={formatNumber(community.requests30d, locale)} />
            <Stat label={t("Completados (30 d)")} value={formatNumber(community.completed30d, locale)} />
            <Stat
              label={t("Completados por usuario activo (30 d)")}
              value={
                community.activeUsers30d > 0
                  ? (community.completed30d / community.activeUsers30d).toFixed(2)
                  : "—"
              }
            />
          </dl>
        </section>

        <section aria-labelledby="stats-history">
          <h2 className="admin-title" id="stats-history">
            {t("Histórico")}
          </h2>
          {samples24h.length < 2 ? (
            <p className="admin-empty">
              {t(
                "Sin histórico todavía. La primera muestra se guarda en el próximo mantenimiento.",
              )}
            </p>
          ) : (
            <div className="admin-sparkline-grid">
              {charts.map((chart) => (
                <div className="admin-sparkline-card" key={chart.label}>
                  <span>{chart.label}</span>
                  <AdminSparkline values={chart.values} label={chart.label} />
                </div>
              ))}
            </div>
          )}
        </section>

        {recent.length > 0 ? (
          <section aria-labelledby="stats-recent">
            <h2 className="admin-title" id="stats-recent">
              {t("Muestras recientes")}
            </h2>
            <div className="admin-table-scroll">
              <table className="admin-sample-table">
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
                  {recent.map((sample) => (
                    <tr key={sample.at}>
                      <td>{formatDate(sample.at, locale, "—")}</td>
                      <td>{formatNumber(sample.requests, locale)}</td>
                      <td>{formatNumber(sample.errors, locale)}</td>
                      <td>{formatMilliseconds(sample.p95Ms, locale)}</td>
                      <td>{formatBytes(sample.walBytes, locale)}</td>
                      <td>{formatNumber(sample.jobsFailed, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </SiteShell>
  );
}
