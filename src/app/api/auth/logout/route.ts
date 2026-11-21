import { cookies } from "next/headers";
import { json } from "@/lib/api";
import { destroySession, SESSION_COOKIE } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/throttle";
import { route } from "@/lib/route";

export const POST = route<undefined, "none">(
  { auth: "none" },
  async ({ request }) => {
    assertSameOrigin(request);
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (token) destroySession(token);
    cookieStore.delete(SESSION_COOKIE);
    return json({ ok: true });
  },
);
