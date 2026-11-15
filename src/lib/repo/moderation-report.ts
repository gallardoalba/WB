import { getDb } from "../db";

export type ModerationReport = {
  sinceDays: number;
  reports: { open: number; reviewed: number; dismissed: number };
  actions: { action: string; count: number }[];
  suspensions: { active: number; endingWithin7Days: number };
  appeals: { open: number; upheld: number; rejected: number };
  averageAppealHours: number | null;
};

/**
 * Cifras agregadas de moderación, sin nombres ni casos concretos.
 *
 * Es lo que una instancia puede publicar para rendir cuentas sin exponer a
 * nadie: cuántas denuncias entran, qué medidas se aplican, cuántas apelaciones
 * se resuelven y cuánto tardan.
 */
export function moderationReport(sinceDays = 30): ModerationReport {
  const db = getDb();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  const reportRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM reports
        WHERE created_at >= ? GROUP BY status`,
    )
    .all(since) as { status: string; count: number }[];
  const reportCount = (status: string) =>
    reportRows.find((row) => row.status === status)?.count ?? 0;

  const actions = db
    .prepare(
      `SELECT action, COUNT(*) AS count FROM admin_audit
        WHERE created_at >= ? GROUP BY action ORDER BY count DESC, action ASC`,
    )
    .all(since) as { action: string; count: number }[];

  const suspensions = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE is_suspended = 1 AND email NOT LIKE 'deleted-%') AS active,
         (SELECT COUNT(*) FROM users
           WHERE is_suspended = 1 AND email NOT LIKE 'deleted-%'
             AND suspended_until IS NOT NULL
             AND suspended_until <= strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days')) AS soon`,
    )
    .get() as { active: number; soon: number };

  const appealRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM appeals
        WHERE created_at >= ? GROUP BY status`,
    )
    .all(since) as { status: string; count: number }[];
  const appealCount = (status: string) =>
    appealRows.find((row) => row.status === status)?.count ?? 0;

  const average = db
    .prepare(
      `SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24) AS hours
         FROM appeals WHERE resolved_at IS NOT NULL AND created_at >= ?`,
    )
    .get(since) as { hours: number | null } | undefined;

  return {
    sinceDays,
    reports: {
      open: reportCount("open"),
      reviewed: reportCount("reviewed"),
      dismissed: reportCount("dismissed"),
    },
    actions,
    suspensions: { active: suspensions.active, endingWithin7Days: suspensions.soon },
    appeals: {
      open: appealCount("open"),
      upheld: appealCount("upheld"),
      rejected: appealCount("rejected"),
    },
    averageAppealHours:
      average?.hours === null || average?.hours === undefined
        ? null
        : Math.round(average.hours * 10) / 10,
  };
}
