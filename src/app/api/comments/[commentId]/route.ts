import { json } from "@/lib/api";
import { deleteBookComment } from "@/lib/repo";
import { route } from "@/lib/route";

/** Borrar un comentario propio (o cualquiera, si la cuenta es de administración). */
export const DELETE = route<undefined, "user", { commentId: string }>(
  { limit: { bucket: "comment:delete", limit: 60, windowMs: 60 * 60 * 1000 } },
  ({ params, user }) => {

    const { commentId } = params;
    deleteBookComment(commentId, { id: user.id, isAdmin: user.isAdmin });
    return json({ ok: true });
  },
);
