import { json } from "@/lib/api";
import {
  MAX_PUSH_PER_USER,
  pushConfig,
  pushSubscriptionCount,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/push";
import { route, DIA } from "@/lib/route";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/lib/validation";

/**
 * Avisos del navegador de la cuenta.
 *
 * `GET` sirve la clave pública VAPID (para eso no hace falta sesión: es pública
 * por diseño) y cuántos dispositivos tiene suscritos la persona. `POST` guarda
 * el dispositivo y `DELETE` lo quita. Un dispositivo que quita el permiso se
 * borra solo en el siguiente envío (404/410 del servicio de push).
 */
export const GET = route(
  { limit: { bucket: "push:read", limit: 120, windowMs: 60 * 60 * 1000 } },
  ({ user }) => {
    const config = pushConfig();
    return json({
      configured: Boolean(config),
      publicKey: config?.publicKey ?? null,
      count: pushSubscriptionCount(user.id),
      max: MAX_PUSH_PER_USER,
    });
  },
);

export const POST = route(
  {
    body: pushSubscriptionSchema,
    limit: { bucket: "push:subscribe", limit: 20, windowMs: DIA },
  },
  ({ request, user, body }) => {
    if (!pushConfig()) return json({ ok: false, configured: false }, 409);
    savePushSubscription({
      userId: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: request.headers.get("user-agent") ?? "",
    });
    return json({ ok: true, count: pushSubscriptionCount(user.id) }, 201);
  },
);

export const DELETE = route(
  {
    body: pushUnsubscribeSchema,
    limit: { bucket: "push:unsubscribe", limit: 60, windowMs: 60 * 60 * 1000 },
  },
  ({ user, body }) => {
    removePushSubscription(user.id, body.endpoint);
    return json({ ok: true, count: pushSubscriptionCount(user.id) });
  },
);
