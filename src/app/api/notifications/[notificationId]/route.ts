import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { deleteNotification, markNotificationRead } from "@/lib/repo";
import { guard } from "@/lib/throttle";

type Params = { params: Promise<{ notificationId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "notifications:read-one", key: user.id, limit: 240, windowMs: 60 * 60 * 1000 });
    const { notificationId } = await params;
    const marked = markNotificationRead(user.id, notificationId);
    // Idempotente: si ya estaba leído (o no es suyo) no se revela nada.
    return json({ ok: true, marked });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "notifications:delete", key: user.id, limit: 240, windowMs: 60 * 60 * 1000 });
    const { notificationId } = await params;
    deleteNotification(user.id, notificationId);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
