import { handleApiError, json, readJson } from "@/lib/api";
import { getSessionUser, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { deleteReadingList, getReadingList, updateReadingList } from "@/lib/repo";
import { guard, hit } from "@/lib/throttle";
import { readingListUpdateSchema } from "@/lib/validation";

type Context = { params: Promise<{ listId: string }> };

/** Detalle de una lista con sus obras (lectura; también sirve la app Android). */
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await getSessionUser();
    if (user) {
      hit({ bucket: "lists:detail", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    } else {
      hit({ bucket: "lists:detail", key: "anon", limit: 240, windowMs: 60 * 60 * 1000 });
    }
    const { listId } = await params;
    const list = getReadingList(listId, user?.id ?? null);
    if (!list) throw new ApiError(404, "Esa lista ya no está disponible.");
    return json({ list });
  } catch (error) {
    return handleApiError(error);
  }
}

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
