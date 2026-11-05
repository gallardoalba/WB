import { handleApiError, json, readJson } from "@/lib/api";
import { getSessionUser, requireUser } from "@/lib/auth";
import { createClubPost, listClubPosts } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubPostSchema } from "@/lib/validation";

type Context = { params: Promise<{ clubId: string }> };

/**
 * El foro es privado del club: leerlo exige sesión **y** pertenencia, así que
 * no es un GET público como el hilo de un libro.
 */
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await getSessionUser();
    const { clubId } = await params;
    const before = new URL(request.url).searchParams.get("before");
    const page = listClubPosts(clubId, user ? { id: user.id, isAdmin: user.isAdmin } : null, {
      beforeId: before,
    });
    return json(page);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "club:post",
      key: user.id,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    const { clubId } = await params;
    const input = clubPostSchema.parse(await readJson(request));
    const post = createClubPost({
      clubId,
      authorId: user.id,
      authorName: user.name,
      body: input.body,
      parentId: input.parentId ?? null,
    });
    return json({ post }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
