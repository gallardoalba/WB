import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createClub } from "@/lib/repo";
import { invalidatePublicData } from "@/lib/revalidate";
import { guard } from "@/lib/throttle";
import { clubSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:create",
      key: user.id,
      limit: 6,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = clubSchema.parse(await readJson(request));
    const club = createClub(user.id, {
      name: input.name,
      city: input.city,
      description: input.description,
      bookId: input.bookId,
      meetsOn: input.meetsOn,
      meetsAt: input.meetsAt,
      joinPolicy: input.joinPolicy,
    });
    invalidatePublicData();
    return json({ club }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
