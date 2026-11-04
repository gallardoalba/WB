import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { countBookWants, isBookWanted, setBookWant } from "@/lib/repo";
import { guard, hit } from "@/lib/throttle";
import { bookWantSchema } from "@/lib/validation";

type Context = { params: Promise<{ bookId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    hit({ bucket: "book:want:read", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    const { bookId } = await params;
    return json({
      wanted: isBookWanted(user.id, bookId),
      count: countBookWants(bookId, user.city),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "book:want",
      key: user.id,
      limit: 120,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { bookId } = await params;
    const { enabled } = bookWantSchema.parse(await readJson(request));
    return json(setBookWant(user.id, bookId, enabled));
  } catch (error) {
    return handleApiError(error);
  }
}
