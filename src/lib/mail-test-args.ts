/**
 * Argumentos de `scripts/mail-test.ts`:
 *
 *   npm run mail:test -- tu@correo [--env /ruta/al/entorno]
 *
 * Vive aquí, y no en el script, para poder probarlo sin lanzar un proceso ni
 * un envío. El fallo que lo motivó: sin `--env`, el índice del valor era
 * `-1 + 1 = 0`, así que se descartaba el **primer argumento** y un
 * destinatario correcto acababa en el mensaje de uso.
 */

export type MailTestArgs = {
  /** Destinatario, o `null` si no se ha pasado uno válido. */
  destinatario: string | null;
  /** Fichero de entorno; vacío si `--env` se pasó sin valor. */
  entorno: string;
};

export const ENTORNO_POR_DEFECTO = "/etc/wanderbibliothek/env";

export function parseMailTestArgs(
  args: string[],
  porDefecto: string = ENTORNO_POR_DEFECTO,
): MailTestArgs {
  const indiceEntorno = args.indexOf("--env");
  // Con `--env` el valor es el argumento siguiente; sin él, no hay índice que
  // excluir (de ahí el -1, que nunca coincide con un índice real).
  const indiceValorEntorno = indiceEntorno === -1 ? -1 : indiceEntorno + 1;

  const entorno = indiceEntorno === -1 ? porDefecto : (args[indiceValorEntorno] ?? "");
  const destinatario =
    args.find((arg, index) => !arg.startsWith("--") && index !== indiceValorEntorno)?.trim() ?? "";

  return { destinatario: destinatario || null, entorno };
}
