import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setClubPostLike } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubPostLikeSchema } from "@/lib/validation";

/** «Me gusta» dentro del foro del club (solo miembros, nunca al tuyo). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ clubId: string; postId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:post:like",
      key: user.id,
      limit: 600,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId, postId } = await params;
    const { liked } = clubPostLikeSchema.parse(await readJson(request));
    return json(setClubPostLike(user.id, clubId, postId, liked));
  } catch (error) {
    return handleApiError(error);
  }
}
