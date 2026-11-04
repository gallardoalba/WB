import { handleApiError, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getTotpState } from "@/lib/repo";

export async function GET() {
  try {
    const user = await requireUser();
    return json(getTotpState(user.id));
  } catch (error) {
    return handleApiError(error);
  }
}
