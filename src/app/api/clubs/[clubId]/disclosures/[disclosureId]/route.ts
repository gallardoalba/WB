import { json } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { markDisclosureRead } from "@/lib/repo";
import { route } from "@/lib/route";

/**
 * Marca como leída una revelación.
 *
 * Deja constancia de que quien modera la ha visto: la moderación por revelación
 * es explícita y atribuible en los dos sentidos.
 */
export const POST = route<undefined, "user", { clubId: string; disclosureId: string }>(
  { limit: { bucket: "club:disclosure:read", limit: 200, windowMs: 24 * 60 * 60 * 1000 } },
  ({ params, user }) => {
    const marked = markDisclosureRead(params.disclosureId, user.id);
    if (!marked) throw new ApiError(404, "Esa revelación no existe o no es para ti.");
    return json({ read: true }, 200);
  },
);
