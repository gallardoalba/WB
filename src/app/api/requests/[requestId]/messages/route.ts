import { after } from "next/server";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { processOutbox } from "@/lib/outbox";
import { addEncryptedMessage, addMessage, conversationKeys, listMessages } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { encryptedMessageSchema, messageSchema } from "@/lib/validation";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireUser();
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
    // Clientes nuevos: `envelopes`. Clientes anteriores a la v40: `ciphertext`.
    const isEncrypted =
      payload !== null &&
      typeof payload === "object" &&
      ("ciphertext" in payload || "envelopes" in payload);
    const message = isEncrypted
      ? addEncryptedMessage(requestId, user.id, encryptedMessageSchema.parse(payload))
      : addMessage(requestId, user.id, messageSchema.parse(payload).body);
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
