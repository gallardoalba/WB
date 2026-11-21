import { json, readJson } from "@/lib/api";
import { addReview } from "@/lib/repo";
import { reviewSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const POST = route<undefined, "user", { requestId: string }>(
  { limit: { bucket: "review:create", limit: 10, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { requestId } = params;

    const { rating, comment } = reviewSchema.parse(await readJson(request));
    addReview(requestId, user.id, rating, comment);
    return json({ ok: true }, 201);
  },
);
