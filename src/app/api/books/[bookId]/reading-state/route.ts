import { json, readJson } from "@/lib/api";
import { countReadingStates, getReadingState, setReadingState } from "@/lib/repo";
import { hit } from "@/lib/throttle";
import { readingStateSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const GET = route<undefined, "user", { bookId: string }>(
  {},
  ({ params, user }) => {
    hit({ bucket: "book:reading:read", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    const { bookId } = params;
    return json({
      status: getReadingState(user.id, bookId),
      ...countReadingStates(bookId),
    });
  },
);

export const POST = route<undefined, "user", { bookId: string }>(
  { limit: { bucket: "book:reading", limit: 120, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { bookId } = params;
    const { status } = readingStateSchema.parse(await readJson(request));
    return json(setReadingState(user.id, bookId, status));
  },
);
