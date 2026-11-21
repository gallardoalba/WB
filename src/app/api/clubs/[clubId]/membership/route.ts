import { json, readJson } from "@/lib/api";
import { setClubMembership } from "@/lib/repo";
import { clubMembershipSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const POST = route<undefined, "user", { clubId: string }>(
  { limit: { bucket: "club:membership", limit: 200, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { clubId } = params;
    const { joined } = clubMembershipSchema.parse(await readJson(request));
    return json(setClubMembership(user.id, clubId, joined));
  },
);
