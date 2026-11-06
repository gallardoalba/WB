import { json } from "@/lib/api";
import { countUnreadNotifications, listNotifications } from "@/lib/repo";
import { route } from "@/lib/route";

const PAGE = 25;

export const GET = route(
  {
    limit: {
      bucket: "notifications:list",
      limit: 240,
      windowMs: 60 * 60 * 1000,
      mode: "hit",
    },
  },
  ({ request, user }) => {
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;

    // Se pide uno de más para saber si quedan páginas sin un COUNT extra.
    const rows = listNotifications(user.id, { limit: PAGE + 1, offset: safeOffset });
    return json({
      notifications: rows.slice(0, PAGE),
      hasMore: rows.length > PAGE,
      offset: safeOffset,
      unread: countUnreadNotifications(user.id),
    });
  },
);
