import { json, readJson } from "@/lib/api";
import { listAvailabilityAlerts, setAvailabilityAlert } from "@/lib/repo";
import { availabilityAlertSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Ciudades para las que esta cuenta quiere recibir novedades. */
export const GET = route(
  {},
  ({ user }) => {
    return json({ cities: listAvailabilityAlerts(user.id) });
  },
);

export const POST = route(
  { limit: { bucket: "alerts:availability", limit: 60, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, user }) => {
    const { city, enabled } = availabilityAlertSchema.parse(await readJson(request));
    setAvailabilityAlert(user.id, city, enabled);
    return json({ cities: listAvailabilityAlerts(user.id) });
  },
);
