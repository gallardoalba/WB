import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireModerator } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { canSanction } from "@/lib/permissions";
import { resolveReport } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { adminActionSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const moderator = await requireModerator();
    const { id } = await params;
    guard(request, {
      bucket: "admin:action",
      key: moderator.id,
      limit: 200,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { action, reason, days } = adminActionSchema.parse(await readJson(request));
    if (action === "suspend_user" && !canSanction(moderator)) {
      throw new ApiError(403, "Solo la administración puede suspender cuentas.");
    }
    resolveReport(moderator.id, id, action, { reason, days });
    invalidatePublicData();
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
