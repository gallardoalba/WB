import { invalidatePublicData } from "@/lib/revalidate";
import { json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { canSanction } from "@/lib/permissions";
import { moderateTarget } from "@/lib/repo";
import { route } from "@/lib/route";
import { moderationSchema } from "@/lib/validation";

/** Acciones de moderación directas (no ligadas a una denuncia concreta). */
export const POST = route<undefined, "moderator">(
  {
    auth: "moderator",
    limit: { bucket: "admin:moderate", limit: 120, windowMs: 60 * 60 * 1000 },
  },
  async ({ request, user }) => {
    const input = moderationSchema.parse(await readJson(request));
    // Moderar contenido no incluye sancionar personas: esa capacidad sigue
    // reservada a administración.
    if (
      (input.action === "suspend_user" || input.action === "unsuspend_user") &&
      !canSanction(user)
    ) {
      throw new ApiError(403, "Solo la administración puede suspender o reactivar cuentas.");
    }
    moderateTarget(user.id, input);
    invalidatePublicData();
    return json({ ok: true });
  },
);
