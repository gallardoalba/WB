import { json, readJson } from "@/lib/api";
import { createClubPoll, getActiveClubPoll } from "@/lib/repo";
import { hit } from "@/lib/throttle";
import { clubPollSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** La votación abierta del club (solo miembros). */
export const GET = route<undefined, "optional", { clubId: string }>(
  { auth: "optional" },
  ({ params, user }) => {
    if (!user) return json({ poll: null }, 401);
    hit({ bucket: "club:poll:read", key: user.id, limit: 300, windowMs: 60 * 60 * 1000 });
    const { clubId } = params;
    return json({ poll: getActiveClubPoll(clubId, user.id) });
  },
);

/** Quien creó el club propone entre dos y cinco obras. */
export const POST = route<undefined, "user", { clubId: string }>(
  { limit: { bucket: "club:poll", limit: 20, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { clubId } = params;
    const input = clubPollSchema.parse(await readJson(request));
    const poll = createClubPoll(user.id, clubId, {
      question: input.question,
      bookIds: input.bookIds,
    });
    return json({ poll }, 201);
  },
);
