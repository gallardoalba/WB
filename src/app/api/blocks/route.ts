import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { blockUser, unblockUser } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { blockSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "block:toggle", key: user.id, limit: 60, windowMs: 60 * 60 * 1000 });
    const { userId } = blockSchema.parse(await readJson(request));
    blockUser(user.id, userId);
    return json({ ok: true }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "block:toggle", key: user.id, limit: 60, windowMs: 60 * 60 * 1000 });
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    if (!userId) return json({ error: "Falta la persona a desbloquear." }, 400);
    unblockUser(user.id, userId);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
