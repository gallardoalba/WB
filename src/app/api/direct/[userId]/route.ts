import { json } from "@/lib/api";
import { directThread, markDirectThreadRead, sendDirectMessage } from "@/lib/repo";
import { route } from "@/lib/route";
import { encryptedMessageSchema } from "@/lib/validation";

/** Lee el hilo directo con otra persona (solo participantes). */
export const GET = route<undefined, "user", { userId: string }>(
  {
    auth: "user",
    limit: { bucket: "dm:read", limit: 600, windowMs: 60_000 },
  },
  ({ user, params }) => json(directThread(user.id, params.userId)),
);

/**
 * Envía un mensaje cifrado. El envoltorio lo produce el navegador; el servidor
 * solo comprueba que la huella es la de tu clave y guarda el sobre.
 */
export const POST = route<typeof encryptedMessageSchema, "user", { userId: string }>(
  {
    body: encryptedMessageSchema,
    limit: { bucket: "dm:send", limit: 120, windowMs: 60 * 60_000 },
  },
  ({ user, body, params }) => {
    const message = sendDirectMessage(user.id, params.userId, body);
    markDirectThreadRead(user.id, params.userId);
    return json(message, 201);
  },
);
