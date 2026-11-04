import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createReadingList, listReadingLists } from "@/lib/repo";
import { guard, hit } from "@/lib/throttle";
import { readingListSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "list:create",
      key: user.id,
      limit: 12,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = readingListSchema.parse(await readJson(request));
    const list = createReadingList(user.id, input);
    return json({ list }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

/** Listas propias (para el selector de «añadir a una lista»). */
export async function GET() {
  try {
    const user = await requireUser();
    hit({ bucket: "lists:list", key: user.id, limit: 240, windowMs: 60 * 60 * 1000 });
    return json({ lists: listReadingLists(user.id, user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}
