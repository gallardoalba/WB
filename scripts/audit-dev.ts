/**
 * Auditoría de las dependencias **de desarrollo**, con el mismo criterio que el
 * escaneo de la imagen: bloquea lo que se puede arreglar hoy e informa de lo que
 * no.
 *
 *   npm run audit:dev        → informe y código de salida
 *
 * `npm audit` a secas devuelve 1 en cuanto hay un aviso, tenga parche o no. Eso
 * deja la integración continua en rojo por un aviso que nadie puede resolver
 * desde el repositorio (pasó con `picomatch` y CVE-2026-112366: la última
 * versión publicada es la vulnerable) y, de paso, incita a saltarse la
 * protección de la rama. Aquí se separa:
 *
 *   - **bloquea**: aviso alto o crítico con una versión corregida que no exige
 *     subir de versión mayor. Es un cambio que se puede hacer en este PR.
 *   - **informa**: sin versión corregida, o con corrección que rompe la API
 *     (`isSemVerMajor`). Queda en el registro y en el resumen del job.
 *
 * Los avisos moderados o bajos no bloquean nada aquí: la política del proyecto
 * solo corta por alto y crítico, igual que `npm audit --omit=dev` en producción.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export type NpmAuditAdvisory = {
  source?: number;
  name?: string;
  title?: string;
  url?: string;
  severity?: string;
};

export type NpmAuditVulnerability = {
  severity?: string;
  via?: (string | NpmAuditAdvisory)[];
  fixAvailable?: boolean | { name: string; version: string; isSemVerMajor: boolean };
};

export type NpmAuditReport = {
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
  metadata?: { vulnerabilities?: Record<string, number> };
};

type Fix =
  | { kind: "minor"; text: string }
  | { kind: "major"; text: string }
  | { kind: "none"; text: string };

export type Finding = {
  package: string;
  severity: string;
  title: string;
  url: string | null;
  /** Cómo se arregla hoy, o por qué no se puede. */
  fix: Fix;
  /** `true` solo si la corrección es un cambio de versión menor. */
  blocking: boolean;
};

const SEVERITIES = ["critical", "high"];

/**
 * Avisos altos o críticos del informe, ya clasificados.
 *
 * `npm audit` repite el mismo aviso en cada eslabón de la cadena (`picomatch`,
 * `fdir`, `tinyglobby`…), así que se recorre `via` y se queda el aviso real: el
 * que trae título y URL. Los eslabones que solo nombran a otro paquete se
 * omiten.
 */
export function reviewDevAudit(report: NpmAuditReport): Finding[] {
  const findings = new Map<string, Finding>();

  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    const severity = vulnerability.severity ?? "low";
    if (!SEVERITIES.includes(severity)) continue;

    const advisories = (vulnerability.via ?? []).filter(
      (via): via is NpmAuditAdvisory => typeof via !== "string",
    );
    // Un eslabón sin aviso propio no aporta: su riesgo ya lo cuenta el paquete
    // del que depende y duplicarlo solo infla el informe.
    if (advisories.length === 0) continue;

    const fix = describeFix(vulnerability.fixAvailable);
    for (const advisory of advisories) {
      const title = advisory.title ?? "Aviso sin título";
      const key = `${advisory.url ?? title}`;
      if (findings.has(key)) continue;
      findings.set(key, {
        package: advisory.name ?? name,
        severity: advisory.severity ?? severity,
        title,
        url: advisory.url ?? null,
        fix,
        blocking: fix.kind === "minor",
      });
    }
  }

  return [...findings.values()].sort(
    (a, b) => Number(b.blocking) - Number(a.blocking) || a.package.localeCompare(b.package),
  );
}

function describeFix(fixAvailable: NpmAuditVulnerability["fixAvailable"]): Fix {
  if (fixAvailable === true) return { kind: "minor", text: "hay versión corregida" };
  if (fixAvailable && typeof fixAvailable === "object") {
    return fixAvailable.isSemVerMajor
      ? {
          kind: "major",
          text: `solo bajando ${fixAvailable.name} a ${fixAvailable.version} (cambio mayor)`,
        }
      : { kind: "minor", text: `actualiza ${fixAvailable.name} a ${fixAvailable.version}` };
  }
  return { kind: "none", text: "sin versión corregida publicada" };
}

/** Texto del informe, para la consola y para el resumen del job. */
export function formatDevAudit(findings: Finding[], counts: Record<string, number> = {}): string {
  const totals = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([severity, value]) => `${value} ${severity}`)
    .join(", ");
  const blocking = findings.filter((finding) => finding.blocking);

  const lines = [
    `Dependencias de desarrollo: ${totals || "sin avisos"}.`,
    ...findings.map((finding) => {
      const state = finding.blocking
        ? `BLOQUEA · ${finding.fix.text}`
        : `informa · ${finding.fix.text}`;
      const link = finding.url ? ` ${finding.url}` : "";
      return `· ${finding.severity.toUpperCase()} ${finding.package}: ${finding.title} (${state})${link}`;
    }),
  ];

  lines.push(
    blocking.length > 0
      ? `${blocking.length} aviso(s) se pueden corregir en este cambio: actualiza y vuelve a ejecutar.`
      : "Ninguno se puede corregir sin un cambio mayor o sin que exista versión corregida: no bloquea.",
  );
  return lines.join("\n");
}

function main(): number {
  let raw = "";
  try {
    raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    // `npm audit` sale con 1 cuando encuentra algo: el informe sí viene en stdout.
    const stdout = (error as { stdout?: unknown }).stdout;
    raw = typeof stdout === "string" ? stdout : "";
  }

  if (!raw.trim()) {
    console.error("No se pudo leer el informe de `npm audit`.");
    return 1;
  }

  const report = JSON.parse(raw) as NpmAuditReport;
  const findings = reviewDevAudit(report);
  const summary = formatDevAudit(findings, report.metadata?.vulnerabilities);
  console.log(summary);

  // En Actions, el informe se queda a la vista en la propia ejecución.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Dependencias de desarrollo\n\n\`\`\`\n${summary}\n\`\`\`\n`,
    );
  }

  return findings.some((finding) => finding.blocking) ? 1 : 0;
}

// Mismo guardia que el resto de `scripts/`: se ejecuta solo al llamarlo, para
// que las pruebas puedan importar `reviewDevAudit` sin lanzar `npm audit`.
if (process.argv[1]?.endsWith("audit-dev.ts")) {
  process.exit(main());
}
