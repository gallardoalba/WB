import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { addToList, removeFromList } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { readingListItemSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "list:item",
      key: user.id,
      limit: 300,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { listId } = await params;
    const { bookId } = readingListItemSchema.parse(await readJson(request));
    addToList(user.id, listId, bookId);
    return json({ ok: true }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "list:item",
      key: user.id,
      limit: 300,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { listId } = await params;
    const bookId = new URL(request.url).searchParams.get("bookId") ?? "";
    if (!bookId) return json({ error: "Falta el libro." }, 400);
    removeFromList(user.id, listId, bookId);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
