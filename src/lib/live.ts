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
/**
 * Tope global de flujos abiertos. Uno por usuario no basta: mil cuentas
 * conectadas son mil descriptores y mil temporizadores contra SQLite. Se puede
 * ajustar con `SSE_MAX_STREAMS` sin recompilar.
 */
function maxTotalStreams(): number {
  const configured = Number(process.env.SSE_MAX_STREAMS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 500;
}

const openStreams = new Map<string, number>();
let totalStreams = 0;

/** `user`: tope por cuenta; `global`: la instancia está al límite. */
export type StreamSlot = "ok" | "user" | "global";

export function acquireStream(userId: string): StreamSlot {
  if (totalStreams >= maxTotalStreams()) return "global";
  const current = openStreams.get(userId) ?? 0;
  if (current >= MAX_STREAMS_PER_USER) return "user";
  openStreams.set(userId, current + 1);
  totalStreams += 1;
  return "ok";
}

export function releaseStream(userId: string): void {
  const current = openStreams.get(userId) ?? 0;
  if (current <= 1) openStreams.delete(userId);
  else openStreams.set(userId, current - 1);
  if (current > 0) totalStreams = Math.max(0, totalStreams - 1);
}

/** Flujos abiertos ahora mismo (para métricas y el cron). */
export function openStreamCount(): number {
  return totalStreams;
}
