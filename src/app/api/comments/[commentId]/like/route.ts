import { json } from "@/lib/api";
import { setCommentLike } from "@/lib/repo";
import { DIA, route } from "@/lib/route";
import { commentLikeSchema } from "@/lib/validation";

export const POST = route<typeof commentLikeSchema, "user", { commentId: string }>(
  { body: commentLikeSchema, limit: { bucket: "comment:like", limit: 400, windowMs: DIA } },
  ({ user, body, params }) => json(setCommentLike(user.id, params.commentId, body.liked)),
);
