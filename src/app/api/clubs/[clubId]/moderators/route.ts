import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setClubModerator } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubModeratorSchema } from "@/lib/validation";

/**
 * Nombrar (o retirar) a un moderador del club.
 *
 * Moderar es ayudar a llevar el club, no llevarlo: quien lo creó sigue siendo
 * el único que lo edita, lo cede o lo cierra.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ clubId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:moderator",
      key: user.id,
      limit: 100,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId } = await params;
    const { userId, moderator } = clubModeratorSchema.parse(await readJson(request));
    return json(setClubModerator(user.id, clubId, userId, moderator));
  } catch (error) {
    return handleApiError(error);
  }
}
