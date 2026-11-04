import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setClubMembership } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubMembershipSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clubId: string }> },
) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:membership",
      key: user.id,
      limit: 200,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { clubId } = await params;
    const { joined } = clubMembershipSchema.parse(await readJson(request));
    return json(setClubMembership(user.id, clubId, joined));
  } catch (error) {
    return handleApiError(error);
  }
}
