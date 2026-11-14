import { after } from "next/server";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { processOutbox } from "@/lib/outbox";
import { addEncryptedMessage, conversationKeys, listMessages } from "@/lib/repo";
import { guard, hit } from "@/lib/throttle";
import { encryptedMessageSchema } from "@/lib/validation";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireUser();
    // Lectura con cuota: el hilo se puede sondear y no debe ser un amplificador.
    hit({ bucket: "message:list", key: user.id, limit: 600, windowMs: 60 * 60 * 1000 });
    const { requestId } = await params;
    const beforeId = new URL(request.url).searchParams.get("before");
    const page = listMessages(requestId, user.id, { beforeId });
    // Las claves públicas viajan con el hilo: el cliente deriva el secreto
    // compartido sin una petición extra.
    return json({ ...page, keys: conversationKeys(requestId, user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireUser();
    const { requestId } = await params;
    guard(request, {
      bucket: "message:create",
      key: user.id,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
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
  } catch (error) {
    return handleApiError(error);
  }
}
