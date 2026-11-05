import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { closeClubPoll } from "@/lib/repo";
import { guard } from "@/lib/throttle";

/** Cierra la votación (solo quien creó el club). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ clubId: string; pollId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:poll:close",
      key: user.id,
      limit: 40,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId, pollId } = await params;
    return json({ poll: closeClubPoll(user.id, clubId, pollId) });
  } catch (error) {
    return handleApiError(error);
  }
}
