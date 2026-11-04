import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { addReview } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { reviewSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireUser();
    const { requestId } = await params;
    guard(request, {
      bucket: "review:create",
      key: user.id,
      limit: 10,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { rating, comment } = reviewSchema.parse(await readJson(request));
    addReview(requestId, user.id, rating, comment);
    return json({ ok: true }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
