/**
 * Identificador numérico de un texto traducible.
 *
 * El diccionario alemán viaja al navegador en cada respuesta. Enviarlo como
 * `{ "texto en castellano": "die Übersetzung" }` duplica el peso, porque la clave
 * es otra frase entera: medido, eran 236 KB de HTML en alemán frente a 50 KB en
 * castellano. Con un identificador estable la clave ocupa diez dígitos y el
 * texto origen no viaja, así que el mismo diccionario pesa la mitad sin dejar de
 * mandar ninguna traducción.
 *
 * FNV-1a de 32 bits: barato, determinista y suficiente para 1 257 entradas.
 * `tests/i18n.test.ts` comprueba que no hay colisiones en el diccionario actual:
 * un choque futuro (al añadir textos) rompe la suite antes de llegar a
 * producción, que es justo el momento de enterarse.
 */

/** Caché de identificadores: los mismos textos se piden en cada render. */
const CACHE = new Map<string, number>();

export function messageId(text: string): number {
  const cached = CACHE.get(text);
  if (cached !== undefined) return cached;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const id = hash >>> 0;
  CACHE.set(text, id);
  return id;
}

/** Diccionario indexado por identificador, listo para viajar al cliente. */
export function messagesById(dictionary: Record<string, string>): Record<number, string> {
  const byId: Record<number, string> = {};
  for (const [text, value] of Object.entries(dictionary)) {
    byId[messageId(text)] = value;
  }
  return byId;
}
