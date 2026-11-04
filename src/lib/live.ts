import { EventEmitter } from "node:events";

/**
 * Avisos en proceso para SSE.
 *
 * No sustituye al sondeo de la base (que sigue siendo la fuente de verdad y
 * permite varias instancias): elimina la latencia normal y reduce consultas.
 * El contenido nunca viaja por aquí, solo “hay novedades en esta solicitud”.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publishRequestMessage(requestId: string): void {
  bus.emit(`request:${requestId}`);
}

export function onRequestMessage(requestId: string, listener: () => void): () => void {
  const event = `request:${requestId}`;
  bus.on(event, listener);
  return () => bus.off(event, listener);
}
