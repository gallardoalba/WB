import { json } from "@/lib/api";
import { cityName } from "@/lib/city-name";
import { updateProfile } from "@/lib/repo";
import { invalidatePublicData } from "@/lib/revalidate";
import { DIA, route } from "@/lib/route";
import { profileUpdateSchema } from "@/lib/validation";

export const PATCH = route(
  { body: profileUpdateSchema, limit: { bucket: "account:profile", limit: 30, windowMs: DIA } },
  async ({ user, body }) => {
    const updated = updateProfile(user.id, { ...body, city: await cityName(body.city) });
    // La actividad pública cachea el nombre de quien publica: si no se
    // invalida, el nombre viejo sigue en la portada hasta que caduque.
    invalidatePublicData();
    return json({ user: updated });
  },
);
