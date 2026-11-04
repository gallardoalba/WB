import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setFavorite } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { favoriteSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    guard(request, {
      bucket: "favorite:toggle",
      key: user.id,
      limit: 300,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { favorite } = favoriteSchema.parse(await readJson(request));
    setFavorite(user.id, id, favorite);
    return json({ ok: true, favorite });
  } catch (error) {
    return handleApiError(error);
  }
}
