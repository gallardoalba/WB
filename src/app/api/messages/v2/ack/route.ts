import { json } from "@/lib/api";
import { route } from "@/lib/route";
import { ackEnvelopesSchema } from "@/lib/validation";
import { ackEnvelopes } from "@/lib/repo";

/**
 * Confirma los sobres ya descifrados y los borra.
 *
 * La confirmación la manda el cliente después de descifrar, no el `GET`: si el
 * servidor borrase al entregar, un corte de red perdería mensajes para siempre.
 * Confirmar dos veces no falla; solo borra lo que seguía ahí.
 */
export const POST = route(
  {
    body: ackEnvelopesSchema,
    limit: { bucket: "envelope:ack", limit: 600, windowMs: 60 * 60 * 1000 },
  },
  ({ user, body }) => json({ deleted: ackEnvelopes(user.id, body.deviceId, body.ids) }, 200),
);
