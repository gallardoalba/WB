import { json } from "@/lib/api";
import { currentSessionId } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { listSessions, revokeSession } from "@/lib/repo";
import { route } from "@/lib/route";

/**
 * Sesiones abiertas de la cuenta.
 *
 * La sesión es una cookie: sin esta lista, alguien que entra desde otro sitio
 * no tiene forma de darse cuenta ni de echarlo. Se devuelve el **hash** del
 * token, que identifica la sesión para cerrarla pero no permite usarla.
 */
export const GET = route(
  {
    auth: "user",
    limit: { bucket: "account:sessions:read", limit: 120, windowMs: 60_000, mode: "hit" },
  },
  async ({ user }) => {
    const current = await currentSessionId();
    return json({ sessions: listSessions(user.id, current) });
  },
);

/** Cierra una sesión concreta (no todas: para eso está el cierre de sesión). */
export const DELETE = route(
  {
    auth: "user",
    limit: { bucket: "account:sessions:revoke", limit: 60, windowMs: 60 * 60 * 1000 },
  },
  async ({ request, user }) => {
    const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
    if (!sessionId) throw new ApiError(400, "Falta la sesión que cerrar.");
    if (!revokeSession(user.id, sessionId)) {
      throw new ApiError(404, "Esa sesión ya no existe.");
    }
    // Si era la de este navegador, la cookie deja de valer: el cliente tiene que
    // salir a la portada en vez de seguir con una sesión muerta.
    const current = await currentSessionId();
    return json({ ok: true, current: sessionId === current });
  },
);
