import { cookies } from "next/headers";
import { handleApiError, json } from "@/lib/api";
import { destroySession, SESSION_COOKIE } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/throttle";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (token) destroySession(token);
    cookieStore.delete(SESSION_COOKIE);
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
