import { json, readJson } from "@/lib/api";
import { transferClub } from "@/lib/repo";
import { clubTransferSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Ceder el club a otra persona que ya sea miembro. */
export const POST = route<undefined, "user", { clubId: string }>(
  { limit: { bucket: "club:transfer", limit: 20, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { clubId } = params;
    const { userId } = clubTransferSchema.parse(await readJson(request));
    transferClub(user.id, clubId, userId);
    return json({ ok: true });
  },
);
