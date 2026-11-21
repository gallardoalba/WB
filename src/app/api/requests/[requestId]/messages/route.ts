import { after } from "next/server";
import { json, readJson } from "@/lib/api";
import { processOutbox } from "@/lib/outbox";
import { addEncryptedMessage, conversationKeys, listMessages } from "@/lib/repo";
import { hit } from "@/lib/throttle";
import { encryptedMessageSchema } from "@/lib/validation";
import { route } from "@/lib/route";

export const GET = route<undefined, "user", { requestId: string }>(
  {},
  ({ request, params, user }) => {
    // Lectura con cuota: el hilo se puede sondear y no debe ser un amplificador.
    hit({ bucket: "message:list", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    const { requestId } = params;
    const beforeId = new URL(request.url).searchParams.get("before");
    const page = listMessages(requestId, user.id, { beforeId });
    // Las claves públicas viajan con el hilo: el cliente deriva el secreto
    // compartido sin una petición extra.
    return json({ ...page, keys: conversationKeys(requestId, user.id) });
  },
);

export const POST = route<undefined, "user", { requestId: string }>(
  { limit: { bucket: "message:create", limit: 120, windowMs: 60 * 60 * 1000 } },
  async ({ request, params, user }) => {
    const { requestId } = params;

    const payload = await readJson(request);
    // Solo se aceptan mensajes cifrados. El esquema exige `envelopes` (un sobre
    // por clave activa del destinatario) o el `ciphertext`/`iv` de las pestañas
    // abiertas antes de la v40; un `{ body: "…" }` en claro sale como 422.
    const message = addEncryptedMessage(requestId, user.id, encryptedMessageSchema.parse(payload));
    after(async () => {
      await processOutbox().catch((error: unknown) => {
        console.error("[mail] no se pudo procesar el aviso", error);
      });
    });
    return json({ message }, 201);
  },
);
