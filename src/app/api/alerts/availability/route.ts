import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listAvailabilityAlerts, setAvailabilityAlert } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { availabilityAlertSchema } from "@/lib/validation";

/** Ciudades para las que esta cuenta quiere recibir novedades. */
export async function GET() {
  try {
    const user = await requireUser();
    return json({ cities: listAvailabilityAlerts(user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "alerts:availability",
      key: user.id,
      limit: 60,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { city, enabled } = availabilityAlertSchema.parse(await readJson(request));
    setAvailabilityAlert(user.id, city, enabled);
    return json({ cities: listAvailabilityAlerts(user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}
