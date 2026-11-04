import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setHandoverOffice } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { handoverSchema } from "@/lib/validation";

/**
 * Cambia el punto de entrega de un intercambio aceptado. Solo se aceptan
 * identificadores de la lista de oficinas de Deutsche Post: así no se puede
 * usar este campo para colar una dirección privada.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireUser();
    const { requestId } = await params;
    guard(request, {
      bucket: "request:handover",
      key: user.id,
      limit: 60,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { officeId } = handoverSchema.parse(await readJson(request));
    const updated = setHandoverOffice(requestId, user.id, officeId);
    invalidatePublicData();
    return json({ request: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
