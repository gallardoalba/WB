import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { countReadingStates, getReadingState, setReadingState } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { readingStateSchema } from "@/lib/validation";

type Context = { params: Promise<{ bookId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { bookId } = await params;
    return json({
      status: getReadingState(user.id, bookId),
      ...countReadingStates(bookId),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "book:reading",
      key: user.id,
      limit: 120,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { bookId } = await params;
    const { status } = readingStateSchema.parse(await readJson(request));
    return json(setReadingState(user.id, bookId, status));
  } catch (error) {
    return handleApiError(error);
  }
}
