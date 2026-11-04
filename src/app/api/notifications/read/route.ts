import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { countUnreadNotifications, markNotificationsRead } from "@/lib/repo";
import { guard } from "@/lib/throttle";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "notifications:read", key: user.id, limit: 120, windowMs: 60 * 60 * 1000 });
    markNotificationsRead(user.id);
    return json({ ok: true, unread: countUnreadNotifications(user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}
