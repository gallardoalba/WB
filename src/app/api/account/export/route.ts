import { handleApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { exportAccountData } from "@/lib/repo";
import { hit } from "@/lib/throttle";

export async function GET() {
  try {
    const user = await requireUser();
    hit({ bucket: "account:export", key: user.id, limit: 5, windowMs: 60 * 60 * 1000 });
    const data = exportAccountData(user.id);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="book2peer-${user.id}.json"`,
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
