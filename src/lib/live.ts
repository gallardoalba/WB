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

/**
 * Tope de conexiones en vivo por cuenta.
 *
 * Cada flujo SSE mantiene un temporizador que consulta la base cada 15 s. Sin
 * tope, una sola cuenta podía abrir cientos de conexiones (el limitador cuenta
 * aperturas por hora, no simultáneas) y multiplicar el trabajo de SQLite sin
 * hacer nada útil: una pestaña necesita una.
 */
const MAX_STREAMS_PER_USER = 3;
const openStreams = new Map<string, number>();

export function acquireStream(userId: string): boolean {
  const current = openStreams.get(userId) ?? 0;
  if (current >= MAX_STREAMS_PER_USER) return false;
  openStreams.set(userId, current + 1);
  return true;
}

export function releaseStream(userId: string): void {
  const current = openStreams.get(userId) ?? 0;
  if (current <= 1) openStreams.delete(userId);
  else openStreams.set(userId, current - 1);
}
