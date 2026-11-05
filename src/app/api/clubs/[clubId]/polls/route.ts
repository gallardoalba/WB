import { handleApiError, json, readJson } from "@/lib/api";
import { getSessionUser, requireUser } from "@/lib/auth";
import { createClubPoll, getActiveClubPoll } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubPollSchema } from "@/lib/validation";

type Context = { params: Promise<{ clubId: string }> };

/** La votación abierta del club (solo miembros). */
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await getSessionUser();
    if (!user) return json({ poll: null }, 401);
    const { clubId } = await params;
    return json({ poll: getActiveClubPoll(clubId, user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Quien creó el club propone entre dos y cinco obras. */
export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:poll",
      key: user.id,
      limit: 20,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId } = await params;
    const input = clubPollSchema.parse(await readJson(request));
    const poll = createClubPoll(user.id, clubId, {
      question: input.question,
      bookIds: input.bookIds,
    });
    return json({ poll }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
