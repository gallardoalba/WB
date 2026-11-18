/**
 * Radiografía de la agrupación por obra.
 *
 *   npm run db:works            → informe de la base configurada
 *   npm run db:works -- --todos → incluye las obras de una sola edición
 *
 * Antes de cambiar el modelo hay que saber cómo está: cuántas ediciones
 * comparten obra, cuántas obras vienen de Open Library y cuántas de la clave
 * derivada del título, y dónde la heurística puede estar equivocándose (misma
 * clave con títulos que no se parecen, o el mismo título repartido en claves
 * distintas). Sin esos números, cualquier rediseño se decide a ciegas.
 */
import path from "node:path";

import { getDb } from "../src/lib/db/index";
import { normalizeText } from "../src/lib/text";

export type WorkRow = {
  id: string;
  title: string;
  author: string;
  work_key: string | null;
};

export type WorkGroup = {
  /** Clave de obra; `null` cuando la fila no tiene ninguna. */
  key: string | null;
  /** `ol` si la clave viene de Open Library, `title` si es la derivada. */
  source: "ol" | "title" | "ninguna";
  editions: { id: string; title: string; author: string }[];
  /** Títulos principales distintos dentro del grupo, ya normalizados. */
  titles: string[];
};

export type WorksReport = {
  books: number;
  works: number;
  withoutKey: number;
  bySource: Record<WorkGroup["source"], number>;
  /** Obras con más de una edición. */
  grouped: WorkGroup[];
  /** Grupos cuya clave une títulos que no se parecen: posible colisión. */
  suspicious: WorkGroup[];
  /** El mismo título repartido en más de una clave: posible obra sin agrupar. */
  split: { title: string; keys: string[] }[];
};

function sourceOf(key: string | null): WorkGroup["source"] {
  if (!key) return "ninguna";
  return key.startsWith("ol:") ? "ol" : "title";
}

/** Título principal normalizado: sin subtítulo y sin artículos. */
function mainTitle(title: string): string {
  return normalizeText((title.split(/[:—]/)[0] ?? title).trim());
}

export function analyzeWorks(rows: WorkRow[]): WorksReport {
  // Una fila sin clave es una obra en sí misma (el catálogo público usa su
  // propio id como clave): no se agrupan entre ellas.
  const groups = new Map<string, WorkRow[]>();
  for (const row of rows) {
    const key = row.work_key?.trim() ? row.work_key : `sin:${row.id}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const bySource: Record<WorkGroup["source"], number> = { ol: 0, title: 0, ninguna: 0 };
  const works: WorkGroup[] = [];
  for (const [groupKey, rows2] of groups) {
    const key = groupKey.startsWith("sin:") ? null : groupKey;
    const source = sourceOf(key);
    bySource[source] += 1;
    works.push({
      key,
      source,
      editions: rows2.map((row) => ({ id: row.id, title: row.title, author: row.author })),
      titles: [...new Set(rows2.map((row) => mainTitle(row.title)))],
    });
  }

  // Mismo título principal en claves distintas: la heurística no ha unido lo
  // que probablemente era la misma obra (autorías escritas de otra forma).
  const keysByTitle = new Map<string, Set<string>>();
  for (const work of works) {
    for (const title of work.titles) {
      if (!title) continue;
      const keys = keysByTitle.get(title) ?? new Set<string>();
      keys.add(work.key ?? `sin-clave:${work.editions[0]?.id ?? "?"}`);
      keysByTitle.set(title, keys);
    }
  }

  return {
    books: rows.length,
    works: works.length,
    withoutKey: bySource.ninguna,
    bySource,
    grouped: works.filter((work) => work.editions.length > 1),
    suspicious: works.filter((work) => work.editions.length > 1 && work.titles.length > 1),
    split: [...keysByTitle.entries()]
      .filter(([, keys]) => keys.size > 1)
      .map(([title, keys]) => ({ title, keys: [...keys] })),
  };
}

export function formatReport(report: WorksReport, showAll = false): string {
  const lines = [
    `${report.books} ediciones en ${report.works} obras.`,
    `Claves: ${report.bySource.ol} de Open Library, ${report.bySource.title} derivadas del título` +
      (report.bySource.ninguna > 0 ? `, ${report.bySource.ninguna} sin clave` : "") +
      ".",
    `${report.grouped.length} obra(s) con más de una edición.`,
  ];

  const listed = showAll ? report.grouped : report.grouped.slice(0, 10);
  for (const work of listed) {
    const mark = work.titles.length > 1 ? " ⚠ títulos distintos" : "";
    lines.push(
      `  · ${work.key ?? "(sin clave)"} — ${work.editions.length} ediciones${mark}: ${work.editions
        .map((edition) => `${edition.title} (${edition.author})`)
        .join(" / ")}`,
    );
  }
  if (!showAll && report.grouped.length > listed.length) {
    lines.push(`  … y ${report.grouped.length - listed.length} más (--todos)`);
  }

  if (report.suspicious.length > 0) {
    lines.push("", "Posibles colisiones (una clave con títulos que no se parecen):");
    for (const work of report.suspicious) {
      lines.push(`  · ${work.key}: ${work.titles.join(" | ")}`);
    }
  }

  if (report.split.length > 0) {
    lines.push("", "Posibles obras sin agrupar (mismo título en varias claves):");
    for (const entry of report.split) {
      lines.push(`  · «${entry.title}» → ${entry.keys.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function main(): void {
  const showAll = process.argv.includes("--todos");
  // `getDb()` aplica las migraciones pendientes: el informe siempre ve el
  // esquema de hoy, aunque la base sea de una release anterior.
  const db = getDb();
  const rows = db
    .prepare("SELECT id, title, author, work_key FROM books ORDER BY created_at ASC, id ASC")
    .all() as WorkRow[];
  console.log(formatReport(analyzeWorks(rows), showAll));
  console.log(`\nBase: ${process.env.WANDERBIBLIOTHEK_DB || path.join(process.cwd(), ".data", "wanderbibliothek.db")}`);
}

if (process.argv[1]?.endsWith("works-report.ts")) {
  main();
}
