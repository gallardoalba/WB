import { handleApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { onRequestMessage } from "@/lib/live";
import { requestMessageStamp } from "@/lib/repo";
import { guard } from "@/lib/throttle";

/**
 * Mensajería en vivo con Server-Sent Events.
 *
 * El servidor no empuja contenido: cada pocos segundos compara la huella del
 * último mensaje y, si cambió, avisa al cliente para que vuelva a pedir el
 * hilo (y lo descifre localmente). Así el canal en vivo no filtra nada y
 * funciona aunque el proceso se reinicie.
 *
 * Es un diseño de una sola instancia: si algún día se despliega en varias, la
 * detección sigue siendo correcta porque se consulta la base de datos, no una
 * memoria local.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireUser();
    const { requestId } = await params;
    guard(request, {
      bucket: "request:events",
      key: user.id,
      limit: 300,
      windowMs: 60 * 60 * 1000,
    });
    const initial = requestMessageStamp(requestId, user.id);
    const encoder = new TextEncoder();
    let last = `${initial.count}:${initial.lastId ?? ""}`;
    let poll: ReturnType<typeof setInterval> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;
    let closed = false;

    const stop = () => {
      closed = true;
      unsubscribe?.();
      if (poll) clearInterval(poll);
      if (heartbeat) clearInterval(heartbeat);
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: string) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        };
        send("ready", "{}");

        const checkNow = () => {
          try {
            const stamp = requestMessageStamp(requestId, user.id);
            const snapshot = `${stamp.count}:${stamp.lastId ?? ""}`;
            if (snapshot !== last) {
              last = snapshot;
              send("messages", JSON.stringify(stamp));
            }
          } catch {
            stop();
            controller.close();
          }
        };

        // Camino rápido dentro de la misma instancia; el sondeo queda como
        // respaldo para múltiples procesos o reinicios.
        unsubscribe = onRequestMessage(requestId, checkNow);
        poll = setInterval(checkNow, 15000);
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
        }, 20000);
        request.signal.addEventListener("abort", () => {
          stop();
          try {
            controller.close();
          } catch {
            // Ya cerrado por el cliente.
          }
        });
      },
      cancel() {
        stop();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
