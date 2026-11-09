import { timingSafeEqual } from "node:crypto";
import { handleApiError, json } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { processSocialOutbox, purgeSocialOutbox } from "@/lib/mastodon";
import { processLikes, purgeSocialLikes } from "@/lib/mastodon-likes";
import { processOutbox, purgeOutbox } from "@/lib/outbox";
import { runMaintenance } from "@/lib/repo";
import { hit } from "@/lib/throttle";

/**
 * Tareas periódicas para un cron externo:
 *   curl -X POST -H "Authorization: Bearer $MAINTENANCE_TOKEN" /api/cron/maintenance
 *
 * Sin `MAINTENANCE_TOKEN` configurado el endpoint responde 404 (no existe) para
 * no abrir una tarea de escritura anónima.
 */
export async function POST(request: Request) {
  try {
    const token = process.env.MAINTENANCE_TOKEN;
    if (!token) throw new ApiError(404, "No encontrado.");

    const header = request.headers.get("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!safeEqual(provided, token)) throw new ApiError(401, "Token no válido.");

    hit({ bucket: "cron:maintenance", key: "all", limit: 6, windowMs: 60 * 60 * 1000 });

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
    // Avisos de Mastodon que no salieron al publicar (instancia caída, 429):
    // aquí van los reintentos, y los entregados antiguos se purgan.
    const social = await run("social", () => processSocialOutbox({ limit: 5 }));
    const purgedSocial = await run("purgedSocial", () => purgeSocialOutbox());
    // «Me gusta» a publicaciones sobre libros. Se apaga solo si falta
    // `MASTODON_LIKES=on`, y respeta su propio tope y su descanso.
    const likes = await run("likes", () => processLikes());
    const purgedLikes = await run("purgedLikes", () => purgeSocialLikes());
    const maintenance = await run("maintenance", () => runMaintenance());
    return json({
      // `ok` sigue siendo el estado del endpoint: si algo falló se ve en
      // `failed` y en el valor `null` de esa tarea, sin devolver un 500 que
      // haría creer al cron externo que no corrió nada.
      ok: failed.length === 0,
      failed,
      mail,
      purgedMail,
      social,
      purgedSocial,
      likes,
      purgedLikes,
      ...maintenance,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
