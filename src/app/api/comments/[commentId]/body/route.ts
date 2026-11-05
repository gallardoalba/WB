import { handleApiError, json } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { getCommentBody } from "@/lib/repo";
import { clientKey, hasClientIp, hit } from "@/lib/throttle";

/** Solo el texto de un comentario con spoiler, pedido al pulsar «leerlo». */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ commentId: string }> },
) {
  try {
    if (hasClientIp()) {
      hit({ bucket: "comment:body:ip", key: clientKey(request), limit: 240, windowMs: 60_000 });
    } else {
      hit({ bucket: "comment:body", key: "all", limit: 900, windowMs: 60_000 });
    }
    const { commentId } = await params;
    const user = await getSessionUser();
    return json({ body: getCommentBody(commentId, user?.id ?? null) });
  } catch (error) {
    return handleApiError(error);
  }
}
