import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setHandoverMethod } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { handoverSchema } from "@/lib/validation";

/**
 * Cambia la forma de entrega de un intercambio aceptado: en mano o por correo.
 * Los datos concretos del envío (Packstation o dirección) los guarda quien
 * recibe, en `handover/shipping`.
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
    const body = handoverSchema.parse(await readJson(request));
    const updated = setHandoverMethod(requestId, user.id, body.method);
    invalidatePublicData();
    return json({ request: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
