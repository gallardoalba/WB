import { json, readJson } from "@/lib/api";
import { voteClubPoll } from "@/lib/repo";
import { clubPollVoteSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Un voto por miembro; se puede cambiar mientras la votación siga abierta. */
export const POST = route<undefined, "user", { clubId: string; pollId: string }>(
  { limit: { bucket: "club:poll:vote", limit: 120, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { clubId } = params;
    const { optionId } = clubPollVoteSchema.parse(await readJson(request));
    return json({ poll: voteClubPoll(user.id, clubId, optionId) });
  },
);
