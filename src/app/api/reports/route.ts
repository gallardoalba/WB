import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { reportContent } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { reportSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "report:create",
      key: user.id,
      limit: 5,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = reportSchema.parse(await readJson(request));
    reportContent({ reporterId: user.id, ...input });
    return json({ ok: true }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
