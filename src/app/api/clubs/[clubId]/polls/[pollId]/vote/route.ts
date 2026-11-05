import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { voteClubPoll } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubPollVoteSchema } from "@/lib/validation";

/** Un voto por miembro; se puede cambiar mientras la votación siga abierta. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ clubId: string; pollId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:poll:vote",
      key: user.id,
      limit: 120,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId } = await params;
    const { optionId } = clubPollVoteSchema.parse(await readJson(request));
    return json({ poll: voteClubPoll(user.id, clubId, optionId) });
  } catch (error) {
    return handleApiError(error);
  }
}
