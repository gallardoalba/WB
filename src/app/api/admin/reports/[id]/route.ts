import { invalidatePublicData } from "@/lib/revalidate";
import { json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { canSanction } from "@/lib/permissions";
import { resolveReport } from "@/lib/repo";
import { route } from "@/lib/route";
import { adminActionSchema } from "@/lib/validation";

export const POST = route<undefined, "moderator", { id: string }>(
  {
    auth: "moderator",
    limit: { bucket: "admin:action", limit: 200, windowMs: 24 * 60 * 60 * 1000 },
  },
  async ({ request, params, user }) => {
    const { action, reason, days } = adminActionSchema.parse(await readJson(request));
    if (action === "suspend_user" && !canSanction(user)) {
      throw new ApiError(403, "Solo la administración puede suspender cuentas.");
    }
    resolveReport(user.id, params.id, action, { reason, days });
    invalidatePublicData();
    return json({ ok: true });
  },
);
