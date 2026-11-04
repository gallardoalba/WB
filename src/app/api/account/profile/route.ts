import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { updateProfile } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { profileUpdateSchema } from "@/lib/validation";

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    guard(request, { bucket: "account:profile", key: user.id, limit: 30, windowMs: 24 * 60 * 60 * 1000 });
    const input = profileUpdateSchema.parse(await readJson(request));
    return json({ user: updateProfile(user.id, input) });
  } catch (error) {
    return handleApiError(error);
  }
}
