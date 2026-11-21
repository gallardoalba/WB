import { json, readJson } from "@/lib/api";
import { addToList, removeFromList } from "@/lib/repo";
import { readingListItemSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const POST = route<undefined, "user", { listId: string }>(
  { limit: { bucket: "list:item", limit: 300, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { listId } = params;
    const { bookId } = readingListItemSchema.parse(await readJson(request));
    addToList(user.id, listId, bookId);
    return json({ ok: true }, 201);
  },
);

export const DELETE = route<undefined, "user", { listId: string }>(
  { limit: { bucket: "list:item", limit: 300, windowMs: 24 * 60 * 60 * 1000 } },
  ({ request, params, user }) => {

    const { listId } = params;
    const bookId = new URL(request.url).searchParams.get("bookId") ?? "";
    if (!bookId) return json({ error: "Falta el libro." }, 400);
    removeFromList(user.id, listId, bookId);
    return json({ ok: true });
  },
);
