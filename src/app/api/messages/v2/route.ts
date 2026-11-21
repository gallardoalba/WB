import { json } from "@/lib/api";
import { route } from "@/lib/route";
import { hit } from "@/lib/throttle";
import { deviceIdSchema, sendEnvelopesSchema } from "@/lib/validation";
import { listEnvelopes, storeEnvelopes } from "@/lib/repo";

/**
 * Envía un lote de sobres v2 a los dispositivos de la otra parte.
 *
 * Un mensaje se cifra una vez por dispositivo destinatario, así que el cliente
 * manda varios cuerpos del mismo texto: al servidor llegan ya cerrados y en
 * claro solo viaja a quién van y en qué conversación.
 *
 * Se guarda todo de golpe o no se guarda: si un dispositivo destinatario ya no
 * está activo, el lote entero se rechaza con `409` y el cliente reclama claves
 * nuevas. Media conversación entregada es peor que ninguna.
 */
export const POST = route(
  {
    body: sendEnvelopesSchema,
    limit: { bucket: "envelope:send", limit: 120, windowMs: 60 * 60 * 1000 },
  },
  ({ user, body }) => {
    const stored = storeEnvelopes(user.id, body.senderDeviceId, body.conversation, body.envelopes);
    return json({ stored }, 201);
  },
);

/**
 * Sobres pendientes de **un dispositivo propio** en una conversación.
 *
 * Hace falta decir qué dispositivo pregunta: el mismo mensaje va cifrado por
 * separado para cada uno y un dispositivo no puede abrir el sobre de otro. La
 * lectura va con cuota porque el cliente la sondea.
 */
export const GET = route(
  {},
  ({ user, request }) => {
    hit({ bucket: "envelope:list", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    const params = new URL(request.url).searchParams;
    const deviceId = deviceIdSchema.parse(params.get("device") ?? "");
    const conversation = params.get("conversation") ?? "";
    return json({ envelopes: listEnvelopes(user.id, deviceId, conversation) }, 200, {
      "cache-control": "no-store",
    });
  },
);
