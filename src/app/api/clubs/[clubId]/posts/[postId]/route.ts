import { json } from "@/lib/api";
import { deleteClubPost } from "@/lib/repo";
import { route } from "@/lib/route";

/** Borrar un mensaje del foro: quien lo escribió, quien creó el club o admón. */
export const DELETE = route<undefined, "user", { clubId: string; postId: string }>(
  { limit: { bucket: "club:post:delete", limit: 200, windowMs: 24 * 60 * 60 * 1000 } },
  ({ params, user }) => {

    const { postId } = params;
    deleteClubPost(postId, { id: user.id, isAdmin: user.isAdmin });
    return json({ ok: true });
  },
);
