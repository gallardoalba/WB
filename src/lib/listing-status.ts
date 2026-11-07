import type { MessageKey } from "./i18n";

/**
 * Etiquetas de los estados que no son la disponibilidad normal. La tarjeta y la
 * vista previa marcan con una cinta oscura sobre la portada cualquier ejemplar
 * que ya no esté libre: es el dato que evita pedir un libro que ya voló.
 */
export const STATUS_RIBBON: Record<string, MessageKey> = {
  reserved: "Reservado",
  given: "Entregado",
  paused: "Pausado",
  removed: "Retirado",
};
