import { json, readJson } from "@/lib/api";
import { setFavorite } from "@/lib/repo";
import { favoriteSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const POST = route<undefined, "user", { id: string }>(
  { limit: { bucket: "favorite:toggle", limit: 300, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { id } = params;

    const { favorite } = favoriteSchema.parse(await readJson(request));
    setFavorite(user.id, id, favorite);
    return json({ ok: true, favorite });
  },
);
