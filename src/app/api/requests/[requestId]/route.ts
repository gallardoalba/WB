import { after } from "next/server";
import { invalidatePublicData } from "@/lib/revalidate";
import { json, readJson } from "@/lib/api";
import { processOutbox } from "@/lib/outbox";
import { ApiError } from "@/lib/errors";
import { getRequest, setRequestArchived, updateRequestStatus } from "@/lib/repo";
import { hit } from "@/lib/throttle";
import { requestUpdateSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/** Una solicitud concreta (para la pantalla de intercambio de la app). */
export const GET = route<undefined, "user", { requestId: string }>(
  {},
  ({ params, user }) => {
    hit({ bucket: "requests:detail", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    const { requestId } = params;
    const request_ = getRequest(requestId, user.id);
    if (!request_) throw new ApiError(404, "Esa solicitud no existe.");
    return json({ request: request_ });
  },
);

export const PATCH = route<undefined, "user", { requestId: string }>(
  { limit: { bucket: "request:update", limit: 120, windowMs: 24 * 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { requestId } = params;

    const body = requestUpdateSchema.parse(await readJson(request));
    // Archivar es privado y no mueve el ejemplar: no invalida el catálogo ni
    // encola correo. El cambio de estado sí, porque reserva o libera el libro.
    if (body.archived !== undefined) {
      return json({ request: setRequestArchived(requestId, user.id, body.archived) });
    }
    const updated = updateRequestStatus(requestId, user.id, body.status!);
    invalidatePublicData();
    after(async () => {
      await processOutbox().catch((error: unknown) => {
        console.error("[mail] no se pudo procesar el aviso", error);
      });
    });
    return json({ request: updated });
  },
);
