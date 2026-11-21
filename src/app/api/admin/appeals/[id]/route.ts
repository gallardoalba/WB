import { json, readJson } from "@/lib/api";
import { invalidatePublicData } from "@/lib/revalidate";
import { resolveAppeal } from "@/lib/repo";
import { route } from "@/lib/route";
import { appealResolutionSchema } from "@/lib/validation";

/** Revisión de una apelación. Quien impuso la sanción no puede resolverla. */
export const POST = route<undefined, "moderator", { id: string }>(
  {
    auth: "moderator",
    limit: { bucket: "admin:appeals", limit: 120, windowMs: 60 * 60 * 1000 },
  },
  async ({ request, params, user }) => {
    const { outcome, resolution, externalReviewer } = appealResolutionSchema.parse(
      await readJson(request),
    );
    resolveAppeal(user.id, params.id, outcome, resolution, externalReviewer);
    // Al estimar una apelación la cuenta vuelve al catálogo público.
    invalidatePublicData();
    return json({ ok: true });
  },
);
