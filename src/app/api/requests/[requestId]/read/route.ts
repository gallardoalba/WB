import { json } from "@/lib/api";
import { markRequestRead } from "@/lib/repo";
import { route } from "@/lib/route";

/** Marca la conversación como leída. Es una mutación explícita, no un GET. */
export const POST = route<undefined, "user", { requestId: string }>(
  { limit: { bucket: "request:read", limit: 600, windowMs: 60 * 60 * 1000 } },
  ({ params, user }) => {
    const { requestId } = params;

    markRequestRead(user.id, requestId);
    return json({ ok: true });
  },
);
