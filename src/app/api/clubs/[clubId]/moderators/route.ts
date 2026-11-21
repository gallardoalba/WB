import { json, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { getClub, moderatesClub, setClubModerator } from "@/lib/repo";
import { getDb } from "@/lib/db";
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

/**
 * Quién lleva el club: su dueño y sus moderadores.
 *
 * Lo necesita el cliente para cifrar una revelación solo a ellos. Lo ve
 * cualquier miembro: un club no oculta quién lo modera, y sin saberlo no se
 * puede denunciar con conocimiento.
 */
export const GET = route<undefined, "user", { clubId: string }>(
  {},
  ({ params, user }) => {
    const club = getClub(params.clubId, user.id);
    if (!club) throw new ApiError(404, "El club no existe.");
    if (!moderatesClub(params.clubId, user.id) && !club.isMember) {
      throw new ApiError(403, "Solo quien está en el club ve quién lo modera.");
    }
    const rows = getDb()
      .prepare(
        `SELECT c.owner_id AS user_id, 'owner' AS role FROM clubs c WHERE c.id = ?
         UNION
         SELECT m.user_id, m.role FROM club_members m
          WHERE m.club_id = ? AND m.status = 'member' AND m.role = 'moderator'`,
      )
      .all(params.clubId, params.clubId) as { user_id: string; role: string }[];
    return json({
      moderators: rows.map((row) => ({ id: row.user_id, role: row.role })),
    });
  },
);
