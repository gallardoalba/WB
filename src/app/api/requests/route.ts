import { after } from "next/server";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { processOutbox } from "@/lib/outbox";
import { createRequest, listRequestsPage } from "@/lib/repo";
import { guard, hit } from "@/lib/throttle";
import { requestSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    // La respuesta trae conversaciones con subconsultas: se limita por cuenta
    // para que no sirva de amplificador.
    hit({ bucket: "requests:list", key: user.id, limit: 240, windowMs: 60 * 60 * 1000 });

    // Paginación por cursor (`before=updatedAt|id`): la lista se ordena por la
    // última actividad, así que un desplazamiento repetiría o saltaría filas
    // en cuanto llegara un mensaje entre dos páginas.
    const params = new URL(request.url).searchParams;
    const limite = Number(params.get("limit") ?? "");
    const [antesDe, antesId] = (params.get("before") ?? "").split("|");
    const pagina = listRequestsPage(user.id, {
      limit: Number.isFinite(limite) && limite > 0 ? limite : undefined,
      before: antesDe && antesId ? { updatedAt: antesDe, id: antesId } : undefined,
    });
    return json({
      requests: pagina.items,
      hasMore: pagina.hasMore,
      // Cursor opaco para la página siguiente; `null` cuando no queda nada.
      next: pagina.next ? `${pagina.next.updatedAt}|${pagina.next.id}` : null,
    });
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
