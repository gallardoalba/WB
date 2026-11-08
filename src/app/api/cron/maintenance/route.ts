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
    const mail = await processOutbox(50);
    const purgedMail = purgeOutbox();
    // Avisos de Mastodon que no salieron al publicar (instancia caída, 429):
    // aquí van los reintentos, y los entregados antiguos se purgan.
    const social = await processSocialOutbox({ limit: 5 });
    const purgedSocial = purgeSocialOutbox();
    // «Me gusta» a publicaciones sobre libros. Se apaga solo si falta
    // `MASTODON_LIKES=on`, y respeta su propio tope y su descanso.
    const likes = await processLikes();
    const purgedLikes = purgeSocialLikes();
    return json({
      ok: true,
      mail,
      purgedMail,
      social,
      purgedSocial,
      likes,
      purgedLikes,
      ...runMaintenance(),
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
