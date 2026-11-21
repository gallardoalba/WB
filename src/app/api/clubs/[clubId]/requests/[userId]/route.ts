import { json, readJson } from "@/lib/api";
import { decideClubMembership, removeClubMember } from "@/lib/repo";
import { clubMemberDecisionSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Aprobar o rechazar una solicitud de entrada (solo quien creó el club). */
export const POST = route<undefined, "user", { clubId: string; userId: string }>(
  { limit: { bucket: "club:decide", limit: 300, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { clubId, userId } = params;
    const { approve } = clubMemberDecisionSchema.parse(await readJson(request));
    return json(decideClubMembership(user.id, clubId, userId, approve));
  },
);

/** Retirar a un miembro del club (solo quien lo creó). */
export const DELETE = route<undefined, "user", { clubId: string; userId: string }>(
  { limit: { bucket: "club:remove", limit: 200, windowMs: 24 * 60 * 60 * 1000 } },
  ({ params, user }) => {

    const { clubId, userId } = params;
    removeClubMember(user.id, clubId, userId);
    return json({ ok: true });
  },
);
