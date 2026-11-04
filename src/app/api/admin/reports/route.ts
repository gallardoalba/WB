import { handleApiError, json } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { listReports } from "@/lib/repo";

export async function GET() {
  try {
    await requireAdmin();
    return json({ reports: listReports() }, 200, { "cache-control": "no-store" });
  } catch (error) {
    return handleApiError(error);
  }
}
