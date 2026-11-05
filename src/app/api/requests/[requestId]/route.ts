import { after } from "next/server";
import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { processOutbox } from "@/lib/outbox";
import { requireUser } from "@/lib/auth";
import { updateRequestStatus } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { requestUpdateSchema } from "@/lib/validation";

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
