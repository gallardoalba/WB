import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setCommentLike } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { commentLikeSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ commentId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "comment:like",
      key: user.id,
      limit: 400,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { commentId } = await params;
    const { liked } = commentLikeSchema.parse(await readJson(request));
    const result = setCommentLike(user.id, commentId, liked);
    return json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
