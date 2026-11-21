import { json, readJson } from "@/lib/api";
import { countBookWants, isBookWanted, setBookWant } from "@/lib/repo";
import { hit } from "@/lib/throttle";
import { bookWantSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const GET = route<undefined, "user", { bookId: string }>(
  {},
  ({ params, user }) => {
    hit({ bucket: "book:want:read", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    const { bookId } = params;
    return json({
      wanted: isBookWanted(user.id, bookId),
      count: countBookWants(bookId, user.city),
    });
  },
);

export const POST = route<undefined, "user", { bookId: string }>(
  { limit: { bucket: "book:want", limit: 120, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { bookId } = params;
    const { enabled } = bookWantSchema.parse(await readJson(request));
    return json(setBookWant(user.id, bookId, enabled));
  },
);
