import { json } from "@/lib/api";
import { discloseClubPost } from "@/lib/repo";
import { clubRevealSchema, deviceIdSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Revela un mensaje del club a quien lo modera.
 *
 * El cliente vuelve a cifrar el contenido para el dispositivo de cada moderador
 * y lo manda aquí: el servidor lo guarda sin poder abrirlo y deja constancia de
 * quién reveló qué y por qué. No hay forma de leer el resto del club.
 */
export const POST = route<typeof clubRevealSchema, "user", { clubId: string; postId: string }>(
  {
    body: clubRevealSchema,
    limit: { bucket: "club:reveal", limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  },
  ({ user, body, params }) => {
    for (const envelope of body.envelopes) deviceIdSchema.parse(envelope.recipientDeviceId);
    const disclosure = discloseClubPost({
      clubId: params.clubId,
      postId: params.postId,
      reporterId: user.id,
      reason: body.reason,
      envelopes: body.envelopes,
    });
    return json({ disclosure }, 201);
  },
);
