import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { deleteReadingList, updateReadingList } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { readingListUpdateSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "list:edit", key: user.id, limit: 120, windowMs: 60 * 60 * 1000 });
    const { listId } = await params;
    const input = readingListUpdateSchema.parse(await readJson(request));
    updateReadingList(user.id, listId, input);
    return json({ ok: true });
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
      bucket: "list:delete",
      key: user.id,
      limit: 60,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { listId } = await params;
    deleteReadingList(user.id, listId);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
