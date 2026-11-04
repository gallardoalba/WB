import { after } from "next/server";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { processOutbox } from "@/lib/outbox";
import { createRequest, listRequests } from "@/lib/repo";
import { guard, hit } from "@/lib/throttle";
import { requestSchema } from "@/lib/validation";

export async function GET() {
  try {
    const user = await requireUser();
    // La respuesta trae hasta 500 conversaciones con subconsultas: se limita
    // por cuenta para que no sirva de amplificador.
    hit({ bucket: "requests:list", key: user.id, limit: 240, windowMs: 60 * 60 * 1000 });
    return json({ requests: listRequests(user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    guard(request, {
      bucket: "request:create",
      key: user.id,
      limit: 20,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = requestSchema.parse(await readJson(request));
    const created = createRequest(user.id, input.listingId);
    after(async () => {
      await processOutbox().catch((error: unknown) => {
        console.error("[mail] no se pudo procesar el aviso", error);
      });
    });
    return json({ request: created }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
