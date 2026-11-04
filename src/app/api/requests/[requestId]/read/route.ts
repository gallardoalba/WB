import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { markRequestRead } from "@/lib/repo";
import { guard } from "@/lib/throttle";

/** Marca la conversación como leída. Es una mutación explícita, no un GET. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireUser();
    const { requestId } = await params;
    guard(request, {
      bucket: "request:read",
      key: user.id,
      limit: 600,
      windowMs: 60 * 60 * 1000,
    });
    markRequestRead(user.id, requestId);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
