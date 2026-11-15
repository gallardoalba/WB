/**
 * Informe agregado de moderación, sin datos personales.
 *
 *   npm run informe:moderacion
 *   npm run informe:moderacion -- --days 90
 *   npm run informe:moderacion -- --json
 *
 * Se puede publicar tal cual: solo lleva cifras y nombres de acción.
 */
import { moderationReport } from "../src/lib/repo/moderation-report";
import { getDb } from "../src/lib/db";

const args = process.argv.slice(2);
const json = args.includes("--json");
const daysIndex = args.indexOf("--days");
const days = daysIndex >= 0 ? Number(args[daysIndex + 1]) : 30;
if (!Number.isInteger(days) || days < 1 || days > 3650) {
  console.error("Uso: npm run informe:moderacion -- [--days 30] [--json]");
  process.exit(1);
}

if (!process.env.WANDERBIBLIOTHEK_DB) {
  console.error(
    "Define WANDERBIBLIOTHEK_DB con la base de la instancia (por ejemplo /var/lib/wanderbibliothek/wanderbibliothek.db).",
  );
  process.exit(1);
}

const report = moderationReport(days);
getDb().close();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Informe de moderación · últimos ${days} días\n`);
  console.log(`Denuncias: ${report.reports.open} abiertas, ${report.reports.reviewed} revisadas, ${report.reports.dismissed} descartadas.`);
  console.log(`Suspensiones activas: ${report.suspensions.active} (${report.suspensions.endingWithin7Days} terminan en 7 días).`);
  console.log(`Apelaciones: ${report.appeals.open} abiertas, ${report.appeals.upheld} estimadas, ${report.appeals.rejected} rechazadas.`);
  console.log(
    report.averageAppealHours === null
      ? "Tiempo medio de respuesta: sin apelaciones resueltas en el periodo."
      : `Tiempo medio de respuesta: ${report.averageAppealHours} horas.`,
  );
  console.log("\nAcciones:");
  if (report.actions.length === 0) console.log("  (ninguna)");
  for (const action of report.actions) console.log(`  ${action.action}: ${action.count}`);
}
