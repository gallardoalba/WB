/**
 * Tope del cuerpo JSON de una petición.
 *
 * Vive aparte porque lo necesitan dos lados: `readJson` en el servidor y el
 * cliente v2 antes de cifrar. Si el cliente solo mira el tamaño de un sobre,
 * un mensaje para cinco dispositivos puede pasar su comprobación y morir en el
 * 413 del servidor después de haber avanzado el ratchet.
 */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/**
 * Margen para las claves del objeto JSON que envuelve los sobres.
 *
 * `{"v2":{"senderDeviceId":"…","envelopes":[{"recipientDeviceId":"…","type":0,"body":"…"}]}}`
 * añade unas decenas de bytes por sobre; 256 por sobre y 1 KiB fijo cubren de
 * sobra cualquier identificador válido.
 */
export const JSON_ENVELOPE_OVERHEAD = 256;
export const JSON_FIXED_OVERHEAD = 1024;
