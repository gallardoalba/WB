import { json } from "@/lib/api";
import { getCommentBody } from "@/lib/repo";
import { clientKey, hasClientIp, hit } from "@/lib/throttle";
import { route } from "@/lib/route";

/** Solo el texto de un comentario con spoiler, pedido al pulsar «leerlo». */
export const GET = route<undefined, "optional", { commentId: string }>(
  { auth: "optional" },
  ({ request, params, user }) => {
    if (hasClientIp()) {
      hit({ bucket: "comment:body:ip", key: clientKey(request), limit: 240, windowMs: 60_000 });
    } else {
      hit({ bucket: "comment:body", key: "all", limit: 900, windowMs: 60_000 });
    }
    const { commentId } = params;
    return json({ body: getCommentBody(commentId, user?.id ?? null) });
  },
);
