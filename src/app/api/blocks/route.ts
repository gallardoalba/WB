import { json } from "@/lib/api";
import { blockUser, unblockUser } from "@/lib/repo";
import { route } from "@/lib/route";
import { blockSchema } from "@/lib/validation";

const CUOTA = { bucket: "block:toggle", limit: 60, windowMs: 60 * 60 * 1000 };

export const POST = route({ body: blockSchema, limit: CUOTA }, ({ user, body }) => {
  blockUser(user.id, body.userId);
  return json({ ok: true }, 201);
});

export const DELETE = route({ limit: CUOTA }, ({ request, user }) => {
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return json({ error: "Falta la persona a desbloquear." }, 400);
  unblockUser(user.id, userId);
  return json({ ok: true });
});
