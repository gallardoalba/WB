import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireModerator } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { canSanction } from "@/lib/permissions";
import { moderateTarget } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { moderationSchema } from "@/lib/validation";

/** Acciones de moderación directas (no ligadas a una denuncia concreta). */
export async function POST(request: Request) {
  try {
    const moderator = await requireModerator();
    guard(request, {
      bucket: "admin:moderate",
      key: moderator.id,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    const input = moderationSchema.parse(await readJson(request));
    // Moderar contenido no incluye sancionar personas: esa capacidad sigue
    // reservada a administración.
    if (
      (input.action === "suspend_user" || input.action === "unsuspend_user") &&
      !canSanction(moderator)
    ) {
      throw new ApiError(403, "Solo la administración puede suspender o reactivar cuentas.");
    }
    moderateTarget(moderator.id, input);
    invalidatePublicData();
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
