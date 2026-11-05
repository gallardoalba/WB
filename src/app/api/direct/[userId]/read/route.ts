import { json } from "@/lib/api";
import { markDirectThreadRead } from "@/lib/repo";
import { route } from "@/lib/route";

/** Marca la conversación directa como leída para el contador de no leídos. */
export const POST = route<undefined, "user", { userId: string }>(
  {
    auth: "user",
    limit: { bucket: "dm:read", limit: 600, windowMs: 60_000 },
  },
  ({ user, params }) => {
    markDirectThreadRead(user.id, params.userId);
    return json({ ok: true });
  },
);
