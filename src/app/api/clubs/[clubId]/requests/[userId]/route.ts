import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { decideClubMembership, removeClubMember } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubMemberDecisionSchema } from "@/lib/validation";

/** Aprobar o rechazar una solicitud de entrada (solo quien creó el club). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ clubId: string; userId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:decide",
      key: user.id,
      limit: 300,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId, userId } = await params;
    const { approve } = clubMemberDecisionSchema.parse(await readJson(request));
    return json(decideClubMembership(user.id, clubId, userId, approve));
  } catch (error) {
    return handleApiError(error);
  }
}

/** Retirar a un miembro del club (solo quien lo creó). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ clubId: string; userId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:remove",
      key: user.id,
      limit: 200,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId, userId } = await params;
    removeClubMember(user.id, clubId, userId);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
