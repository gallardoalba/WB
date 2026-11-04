import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listNotifications } from "@/lib/repo";
import { hit } from "@/lib/throttle";

const PAGE = 25;

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    hit({ bucket: "notifications:list", key: user.id, limit: 240, windowMs: 60 * 60 * 1000 });
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;

    // Se pide uno de más para saber si quedan páginas sin un COUNT extra.
    const rows = listNotifications(user.id, { limit: PAGE + 1, offset: safeOffset });
    return json({
      notifications: rows.slice(0, PAGE),
      hasMore: rows.length > PAGE,
      offset: safeOffset,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
