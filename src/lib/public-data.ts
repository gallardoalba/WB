import { cacheLife, cacheTag } from "next/cache";
import { getStats, listActivity } from "./repo";
import type { ActivityView, StatsView } from "./domain";

/**
 * Datos públicos que cambian poco: la portada no necesita recalcularlos en cada
 * visita. Se invalidan por tiempo (y con la etiqueta `public-data`).
 */
export async function publicStats(): Promise<StatsView> {
  "use cache";
  cacheLife("minutes");
  cacheTag("public-data");
  return getStats();
}

export async function publicActivity(): Promise<ActivityView[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("public-data");
  return listActivity();
}
