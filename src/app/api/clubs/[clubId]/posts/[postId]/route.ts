import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { deleteClubPost } from "@/lib/repo";
import { guard } from "@/lib/throttle";

/** Borrar un mensaje del foro: quien lo escribió, quien creó el club o admón. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ clubId: string; postId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:post:delete",
      key: user.id,
      limit: 200,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { postId } = await params;
    deleteClubPost(postId, { id: user.id, isAdmin: user.isAdmin });
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
