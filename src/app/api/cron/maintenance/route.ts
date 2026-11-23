import { json } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { purgeMetricsSamples, recordMetricsSample } from "@/lib/metrics-history";
import { bearerToken, safeEqual } from "@/lib/ops-auth";
import { processOutbox, purgeOutbox } from "@/lib/outbox";
import { runMaintenance } from "@/lib/repo";
import { hit } from "@/lib/throttle";
import { ensureDailyKeySnapshot, ensureDailySnapshot } from "@/lib/transparency";
import { route } from "@/lib/route";

/**
 * Tareas periódicas para un cron externo:
 *   curl -X POST -H "Authorization: Bearer $MAINTENANCE_TOKEN" /api/cron/maintenance
 *
 * Sin `MAINTENANCE_TOKEN` configurado el endpoint responde 404 (no existe) para
 * no abrir una tarea de escritura anónima.
 */
export const POST = route<undefined, "none">(
  { auth: "none" },
  async ({ request }) => {
    const token = process.env.MAINTENANCE_TOKEN;
    if (!token) throw new ApiError(404, "No encontrado.");

    if (!safeEqual(bearerToken(request), token)) throw new ApiError(401, "Token no válido.");

    // El timer dispara cada 15 minutos (4 pasadas por hora). El tope anterior
    // era 6/h y se agotaba en cuanto un despliegue o una prueba manual llamaba
    // al endpoint: la pasada se perdía con un 429 y la unidad quedaba `failed`
    // sin que nada estuviera roto. 20/h deja margen para cinco veces el ritmo
    // normal y sigue impidiendo que el endpoint sea un amplificador.
    hit({ bucket: "cron:maintenance", key: "all", limit: 20, windowMs: 60 * 60 * 1000 });

    // Cada tarea va aislada: un fallo en una (base bloqueada un instante, un
    // proveedor que devuelve algo inesperado) no puede impedir que se ejecuten
    // las demás ni dejar la respuesta sin información de lo que sí se hizo.
    const failed: string[] = [];
    const run = async <T>(name: string, task: () => Promise<T> | T): Promise<T | null> => {
      try {
        return await task();
      } catch (error) {
        failed.push(name);
        console.error(`[cron] ${name} falló`, error);
        return null;
      }
    };

    const mail = await run("mail", () => processOutbox(50));
    const purgedMail = await run("purgedMail", () => purgeOutbox());
    // Una foto cada 15 minutos para el panel de estadísticas de /admin.
    const metrics = await run("metrics", () => recordMetricsSample().at);
    const purgedMetrics = await run("purgedMetrics", () => purgeMetricsSamples());
    const maintenance = await run("maintenance", () => runMaintenance());
    // Una instantánea firmada del catálogo público al día. Si ya hay una de
    // hoy no se repite: el cron pasa cada quince minutos.
    const transparency = await run(
      "transparency",
      () => ensureDailySnapshot()?.id ?? null,
    );
    // El directorio de claves se firma en la misma pasada: sin prueba de
    // inclusión, la transparencia del catálogo no cubre lo que más importa,
    // que es qué clave ve cada parte.
    const keys = await run("keys", () => ensureDailyKeySnapshot()?.id ?? null);
    return json({
      // `ok` sigue siendo el estado del endpoint: si algo falló se ve en
      // `failed` y en el valor `null` de esa tarea, sin devolver un 500 que
      // haría creer al cron externo que no corrió nada.
      ok: failed.length === 0,
      failed,
      mail,
      purgedMail,
      metrics,
      purgedMetrics,
      transparency,
      keys,
      ...maintenance,
    });
  },
);
