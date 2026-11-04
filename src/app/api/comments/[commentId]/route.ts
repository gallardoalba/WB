import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { deleteBookComment } from "@/lib/repo";
import { guard } from "@/lib/throttle";

/** Borrar un comentario propio (o cualquiera, si la cuenta es de administración). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ commentId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "comment:delete",
      key: user.id,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    const { commentId } = await params;
    deleteBookComment(commentId, { id: user.id, isAdmin: user.isAdmin });
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
