import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { updateRequestStatus } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { handoverCodeSchema } from "@/lib/validation";

/** La persona que recibe confirma con el código que le muestra quien entrega. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireUser();
    const { requestId } = await params;
    // El código es de 6 cifras: se limita por intercambio (10 intentos/día)
    // además del tope por cuenta, para que probar códigos no sea viable.
    guard(request, {
      bucket: "request:handover:verify:request",
      key: `${user.id}:${requestId}`,
      limit: 10,
      windowMs: 24 * 60 * 60 * 1000,
    });
    guard(request, {
      bucket: "request:handover:verify",
      key: user.id,
      limit: 30,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { code } = handoverCodeSchema.parse(await readJson(request));
    const updated = updateRequestStatus(requestId, user.id, "completed", {
      handoverCode: code,
    });
    invalidatePublicData();
    return json({ request: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
