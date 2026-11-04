import { handleApiError, json, readJson } from "@/lib/api";
import { getSessionUser, requireUser } from "@/lib/auth";
import { createBookComment, listBookComments } from "@/lib/repo";
import { clientIp, guard, hasClientIp, hit } from "@/lib/throttle";
import { commentSchema } from "@/lib/validation";

/** GET es público: la conversación de un libro la puede leer cualquiera. */
export async function GET(request: Request, { params }: { params: Promise<{ bookId: string }> }) {
  try {
    if (hasClientIp()) {
      hit({ bucket: "comments:read:ip", key: clientIp(request), limit: 240, windowMs: 60_000 });
    } else {
      hit({ bucket: "comments:read", key: "all", limit: 900, windowMs: 60_000 });
    }

    const { bookId } = await params;
    const url = new URL(request.url);
    const before = url.searchParams.get("before");
    const user = await getSessionUser();
    const page = listBookComments(
      bookId,
      user ? { id: user.id, isAdmin: user.isAdmin } : null,
      { beforeId: before },
    );
    return json(page);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ bookId: string }> }) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "comment:write",
      key: user.id,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    const { bookId } = await params;
    const input = commentSchema.parse(await readJson(request));
    const comment = createBookComment({
      bookId,
      authorId: user.id,
      body: input.body,
      spoiler: input.spoiler,
      parentId: input.parentId ?? null,
    });
    return json({ comment }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
