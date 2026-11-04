import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { transferClub } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubTransferSchema } from "@/lib/validation";

/** Ceder el club a otra persona que ya sea miembro. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ clubId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:transfer",
      key: user.id,
      limit: 20,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId } = await params;
    const { userId } = clubTransferSchema.parse(await readJson(request));
    transferClub(user.id, clubId, userId);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
