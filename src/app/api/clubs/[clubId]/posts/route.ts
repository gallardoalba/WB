import { json, readJson } from "@/lib/api";
import { createClubPost, listClubPosts } from "@/lib/repo";
import { hit } from "@/lib/throttle";
import { clubPostSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * El foro es privado del club: leerlo exige sesión **y** pertenencia, así que
 * no es un GET público como el hilo de un libro.
 */
export const GET = route<undefined, "optional", { clubId: string }>(
  { auth: "optional" },
  ({ request, params, user }) => {
    if (user) {
      hit({ bucket: "club:post:list", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    }
    const { clubId } = params;
    const before = new URL(request.url).searchParams.get("before");
    const page = listClubPosts(clubId, user ? { id: user.id, isAdmin: user.isAdmin } : null, {
      beforeId: before,
    });
    return json(page);
  },
);

export const POST = route<undefined, "user", { clubId: string }>(
  { limit: { bucket: "club:post", limit: 120, windowMs: 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { clubId } = params;
    const input = clubPostSchema.parse(await readJson(request));
    const post = createClubPost({
      clubId,
      authorId: user.id,
      authorName: user.name,
      body: input.body,
      parentId: input.parentId ?? null,
    });
    return json({ post }, 201);
  },
);
