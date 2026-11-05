import { json } from "@/lib/api";
import { countUnreadNotifications, markNotificationsRead } from "@/lib/repo";
import { route } from "@/lib/route";

export const POST = route(
  { limit: { bucket: "notifications:read", limit: 120, windowMs: 60 * 60 * 1000 } },
  ({ user }) => {
    markNotificationsRead(user.id);
    return json({ ok: true, unread: countUnreadNotifications(user.id) });
  },
);
