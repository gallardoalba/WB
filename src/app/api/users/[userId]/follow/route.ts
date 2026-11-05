import { json } from "@/lib/api";
import { setFollow } from "@/lib/repo";
import { DIA, route } from "@/lib/route";
import { followSchema } from "@/lib/validation";

export const POST = route<typeof followSchema, "user", { userId: string }>(
  { body: followSchema, limit: { bucket: "follow:toggle", limit: 300, windowMs: DIA } },
  ({ user, body, params }) => json(setFollow(user.id, params.userId, body.follow)),
);
