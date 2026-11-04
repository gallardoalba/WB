import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { moderateTarget } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { moderationSchema } from "@/lib/validation";

/** Acciones de moderación directas (no ligadas a una denuncia concreta). */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    guard(request, { bucket: "admin:moderate", key: admin.id, limit: 120, windowMs: 60 * 60 * 1000 });
    const input = moderationSchema.parse(await readJson(request));
    moderateTarget(admin.id, input);
    invalidatePublicData();
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
