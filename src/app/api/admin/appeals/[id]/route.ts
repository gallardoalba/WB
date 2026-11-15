import { handleApiError, json, readJson } from "@/lib/api";
import { requireModerator } from "@/lib/auth";
import { invalidatePublicData } from "@/lib/revalidate";
import { resolveAppeal } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { appealResolutionSchema } from "@/lib/validation";

/** Revisión de una apelación. Quien impuso la sanción no puede resolverla. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const moderator = await requireModerator();
    const { id } = await params;
    guard(request, {
      bucket: "admin:appeals",
      key: moderator.id,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    const { outcome, resolution } = appealResolutionSchema.parse(await readJson(request));
    resolveAppeal(moderator.id, id, outcome, resolution);
    // Al estimar una apelación la cuenta vuelve al catálogo público.
    invalidatePublicData();
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
