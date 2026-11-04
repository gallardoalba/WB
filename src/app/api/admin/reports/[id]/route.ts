import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { resolveReport } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { adminActionSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    guard(request, {
      bucket: "admin:action",
      key: admin.id,
      limit: 200,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { action } = adminActionSchema.parse(await readJson(request));
    resolveReport(admin.id, id, action);
    invalidatePublicData();
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
