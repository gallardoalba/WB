import { json, readJson } from "@/lib/api";
import { setClubPostLike } from "@/lib/repo";
import { clubPostLikeSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** «Me gusta» dentro del foro del club (solo miembros, nunca al tuyo). */
export const POST = route<undefined, "user", { clubId: string; postId: string }>(
  { limit: { bucket: "club:post:like", limit: 600, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { clubId, postId } = params;
    const { liked } = clubPostLikeSchema.parse(await readJson(request));
    return json(setClubPostLike(user.id, clubId, postId, liked));
  },
);
