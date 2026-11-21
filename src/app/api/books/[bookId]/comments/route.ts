import { json, readJson } from "@/lib/api";
import { createBookComment, listBookComments } from "@/lib/repo";
import { clientIp, hasClientIp, hit } from "@/lib/throttle";
import { commentSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** GET es público: la conversación de un libro la puede leer cualquiera. */
export const GET = route<undefined, "optional", { bookId: string }>(
  { auth: "optional" },
  ({ request, params, user }) => {
    if (hasClientIp()) {
      hit({ bucket: "comments:read:ip", key: clientIp(request), limit: 240, windowMs: 60_000 });
    } else {
      hit({ bucket: "comments:read", key: "all", limit: 900, windowMs: 60_000 });
    }

    const { bookId } = params;
    const url = new URL(request.url);
    const before = url.searchParams.get("before");
    const page = listBookComments(
      bookId,
      user ? { id: user.id, isAdmin: user.isAdmin } : null,
      { beforeId: before },
    );
    return json(page);
  },
);

export const POST = route<undefined, "user", { bookId: string }>(
  { limit: { bucket: "comment:write", limit: 60, windowMs: 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { bookId } = params;
    const input = commentSchema.parse(await readJson(request));
    const comment = createBookComment({
      bookId,
      authorId: user.id,
      body: input.body,
      spoiler: input.spoiler,
      parentId: input.parentId ?? null,
    });
    return json({ comment }, 201);
  },
);
