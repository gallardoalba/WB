import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { inviteToClub } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubInviteSchema } from "@/lib/validation";

/**
 * Invitar a un lector. Solo quien creó el club o alguien que siga a la persona
 * invitada: el club no puede convertirse en un canal de spam.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ clubId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:invite",
      key: user.id,
      limit: 40,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId } = await params;
    const { userId } = clubInviteSchema.parse(await readJson(request));
    inviteToClub(user.id, clubId, userId);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
