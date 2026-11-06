import { after } from "next/server";
import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { processOutbox } from "@/lib/outbox";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { getRequest, updateRequestStatus } from "@/lib/repo";
import { guard, hit } from "@/lib/throttle";
import { requestUpdateSchema } from "@/lib/validation";

type Context = { params: Promise<{ requestId: string }> };

/** Una solicitud concreta (para la pantalla de intercambio de la app). */
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    hit({ bucket: "requests:detail", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    const { requestId } = await params;
    const request_ = getRequest(requestId, user.id);
    if (!request_) throw new ApiError(404, "Esa solicitud no existe.");
    return json({ request: request_ });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireUser();
    const { requestId } = await params;
    guard(request, {
      bucket: "request:update",
      key: user.id,
      limit: 120,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { status } = requestUpdateSchema.parse(await readJson(request));
    const updated = updateRequestStatus(requestId, user.id, status);
    invalidatePublicData();
    after(async () => {
      await processOutbox().catch((error: unknown) => {
        console.error("[mail] no se pudo procesar el aviso", error);
      });
    });
    return json({ request: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
