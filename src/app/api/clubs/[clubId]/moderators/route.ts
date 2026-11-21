import { json, readJson } from "@/lib/api";
import { setClubModerator } from "@/lib/repo";
import { clubModeratorSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Nombrar (o retirar) a un moderador del club.
 *
 * Moderar es ayudar a llevar el club, no llevarlo: quien lo creó sigue siendo
 * el único que lo edita, lo cede o lo cierra.
 */
export const POST = route<undefined, "user", { clubId: string }>(
  { limit: { bucket: "club:moderator", limit: 100, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { clubId } = params;
    const { userId, moderator } = clubModeratorSchema.parse(await readJson(request));
    return json(setClubModerator(user.id, clubId, userId, moderator));
  },
);
