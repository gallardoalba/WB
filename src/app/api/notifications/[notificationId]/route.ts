import { json } from "@/lib/api";
import { deleteNotification, markNotificationRead } from "@/lib/repo";
import { route } from "@/lib/route";

type Params = { notificationId: string };

export const PATCH = route<undefined, "user", Params>(
  { limit: { bucket: "notifications:read-one", limit: 240, windowMs: 60 * 60 * 1000 } },
  ({ user, params }) => {
    const marked = markNotificationRead(user.id, params.notificationId);
    // Idempotente: si ya estaba leído (o no es suyo) no se revela nada.
    return json({ ok: true, marked });
  },
);

export const DELETE = route<undefined, "user", Params>(
  { limit: { bucket: "notifications:delete", limit: 240, windowMs: 60 * 60 * 1000 } },
  ({ user, params }) => {
    deleteNotification(user.id, params.notificationId);
    return json({ ok: true });
  },
);
