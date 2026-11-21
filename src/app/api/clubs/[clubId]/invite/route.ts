import { json, readJson } from "@/lib/api";
import { inviteToClub } from "@/lib/repo";
import { clubInviteSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Invitar a un lector. Solo quien creó el club o alguien que siga a la persona
 * invitada: el club no puede convertirse en un canal de spam.
 */
export const POST = route<undefined, "user", { clubId: string }>(
  { limit: { bucket: "club:invite", limit: 40, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { clubId } = params;
    const { userId } = clubInviteSchema.parse(await readJson(request));
    inviteToClub(user.id, clubId, userId);
    return json({ ok: true });
  },
);
