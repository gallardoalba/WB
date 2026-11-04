import { revalidateTag } from "next/cache";

/**
 * Invalida los agregados públicos cacheados (`publicStats`, `publicActivity`).
 * Se llama desde las rutas que mutan el catálogo o la moderación; fuera de una
 * petición (pruebas, scripts) no hace nada.
 */
export function invalidatePublicData(): void {
  try {
    // `max` = stale-while-revalidate: la siguiente visita sirve lo viejo y
    // recalcula por detrás.
    revalidateTag("public-data", "max");
  } catch {
    // Sin contexto de petición (scripts/tests): no hay caché que invalidar.
  }
}
