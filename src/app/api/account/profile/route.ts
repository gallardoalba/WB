import { json } from "@/lib/api";
import { cityName } from "@/lib/city-name";
import { updateProfile } from "@/lib/repo";
import { DIA, route } from "@/lib/route";
import { profileUpdateSchema } from "@/lib/validation";

export const PATCH = route(
  { body: profileUpdateSchema, limit: { bucket: "account:profile", limit: 30, windowMs: DIA } },
  async ({ user, body }) =>
    json({
      user: updateProfile(user.id, { ...body, city: await cityName(body.city) }),
    }),
);
