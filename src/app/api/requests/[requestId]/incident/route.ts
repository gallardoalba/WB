import { json } from "@/lib/api";
import { submitIncidentResponse } from "@/lib/repo";
import { route } from "@/lib/route";
import { incidentResponseSchema } from "@/lib/validation";

type Params = { requestId: string };

/**
 * La otra parte responde a una incidencia de entrega.
 *
 * Quien abrió la incidencia ya escribió su versión al denunciar; esta ruta
 * guarda la de la otra persona para que moderación lea las dos.
 */
export const POST = route<typeof incidentResponseSchema, "user", Params>(
  {
    body: incidentResponseSchema,
    limit: { bucket: "request:incident", limit: 20, windowMs: 24 * 60 * 60 * 1000 },
  },
  ({ user, params, body }) => {
    submitIncidentResponse(params.requestId, user.id, body.response);
    return json({ ok: true });
  },
);
