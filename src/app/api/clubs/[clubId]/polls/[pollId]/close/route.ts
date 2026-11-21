import { json } from "@/lib/api";
import { closeClubPoll } from "@/lib/repo";
import { route } from "@/lib/route";

/** Cierra la votación (solo quien creó el club). */
export const POST = route<undefined, "user", { clubId: string; pollId: string }>(
  { limit: { bucket: "club:poll:close", limit: 40, windowMs: 24 * 60 * 60 * 1000 } },
  ({ params, user }) => {

    const { clubId, pollId } = params;
    return json({ poll: closeClubPoll(user.id, clubId, pollId) });
  },
);
