import { json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { deleteReadingList, getReadingList, updateReadingList } from "@/lib/repo";
import { hit } from "@/lib/throttle";
import { readingListUpdateSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Detalle de una lista con sus obras (lectura; también sirve la app Android). */
export const GET = route<undefined, "optional", { listId: string }>(
  { auth: "optional" },
  ({ params, user }) => {
    if (user) {
      hit({ bucket: "lists:detail", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    } else {
      hit({ bucket: "lists:detail", key: "anon", limit: 240, windowMs: 60 * 60 * 1000 });
    }
    const { listId } = params;
    const list = getReadingList(listId, user?.id ?? null);
    if (!list) throw new ApiError(404, "Esa lista ya no está disponible.");
    return json({ list });
  },
);

export const PATCH = route<undefined, "user", { listId: string }>(
  { limit: { bucket: "list:edit", limit: 120, windowMs: 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { listId } = params;
    const input = readingListUpdateSchema.parse(await readJson(request));
    updateReadingList(user.id, listId, input);
    return json({ ok: true });
  },
);

export const DELETE = route<undefined, "user", { listId: string }>(
  { limit: { bucket: "list:delete", limit: 60, windowMs: 24 * 60 * 60 * 1000 } },
  ({ params, user }) => {

    const { listId } = params;
    deleteReadingList(user.id, listId);
    return json({ ok: true });
  },
);
