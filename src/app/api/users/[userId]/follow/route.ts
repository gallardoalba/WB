import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setFollow } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { followSchema } from "@/lib/validation";

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "follow:toggle",
      key: user.id,
      limit: 300,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { userId } = await params;
    const { follow } = followSchema.parse(await readJson(request));
    return json(setFollow(user.id, userId, follow));
  } catch (error) {
    return handleApiError(error);
  }
}
