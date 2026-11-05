import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setShippingAddress } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { shippingSchema } from "@/lib/validation";

/**
 * Guarda a dónde viaja el libro: una Packstation o la dirección de quien lo
 * recibe.
 *
 * Solo puede hacerlo quien lo recibe: son sus datos. Todos los campos se cifran
 * antes de tocar la base de datos, así que ni la administración los lee.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireUser();
    const { requestId } = await params;
    guard(request, {
      bucket: "request:shipping",
      key: user.id,
      limit: 30,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = shippingSchema.parse(await readJson(request));
    const compacto = (value: string) => value.replace(/\s+/g, " ").trim();
    const updated = setShippingAddress(
      requestId,
      user.id,
      input.kind === "packstation"
        ? {
            kind: "packstation",
            postNumber: input.postNumber,
            station: input.station.replace(/^packstation\s*/i, "Packstation "),
            postalCode: input.postalCode,
            city: compacto(input.city),
          }
        : {
            kind: "address",
            street: compacto(input.street),
            postalCode: input.postalCode,
            city: compacto(input.city),
          },
    );
    invalidatePublicData();
    return json({ request: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
