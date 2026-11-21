import { json, readJson } from "@/lib/api";
import { reportContent } from "@/lib/repo";
import { reportSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const POST = route(
  { limit: { bucket: "report:create", limit: 5, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, user }) => {
    const input = reportSchema.parse(await readJson(request));
    reportContent({ reporterId: user.id, ...input });
    return json({ ok: true }, 201);
  },
);
