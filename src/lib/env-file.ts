/**
 * Lectura del `EnvironmentFile` de systemd.
 *
 * Los scripts de operación se lanzan a mano (`sudo npm run mail:test -- …`) y
 * en ese proceso **no** está el entorno que systemd inyecta al servicio. Sin
 * esto, una clave de Brevo recién puesta parecería «no configurada» y se
 * buscaría el fallo donde no está.
 *
 * Ojo con el usuario: el fichero es de root (600), así que lanzarlo con
 * `sudo -u wanderbibliothek` falla al leerlo; para eso está `envFileProblem`.
 *
 * Solo se rellenan las variables que faltan: exportar algo en la línea de
 * órdenes siempre gana sobre el fichero.
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";

/** `KEY=valor`, con `export` opcional delante. */
const LINEA = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Interpreta un `EnvironmentFile` de systemd: `KEY=valor`, `#` (o `;`) para
 * comentar y comillas simples o dobles alrededor del valor. Devuelve solo las
 * claves que se han podido leer; las líneas rotas se ignoran, como hace systemd.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const match = LINEA.exec(line);
    if (!match) continue;

    const key = match[1]!;
    const rest = (match[2] ?? "").trim();

    if (
      rest.length >= 2 &&
      ((rest.startsWith('"') && rest.endsWith('"')) || (rest.startsWith("'") && rest.endsWith("'")))
    ) {
      values[key] = rest.slice(1, -1);
      continue;
    }

    // Sin comillas, un `#` precedido de espacio abre un comentario al final
    // (`TRUST_PROXY=1  # detrás de nginx`). Un `#` pegado al valor se conserva:
    // aparece en claves y en contraseñas.
    const comment = rest.search(/\s#/);
    values[key] = comment === -1 ? rest : rest.slice(0, comment).trim();
  }

  return values;
}

/**
 * Explica por qué no se puede leer el fichero, o `null` si no hay problema.
 *
 * El `EnvironmentFile` del servicio es de root (600), así que lanzar un script
 * con `sudo -u wanderbibliothek` lo deja sin entorno **sin avisar**: el error
 * de permisos se confundía con «no hay proveedor configurado» y se buscaba el
 * fallo en la clave.
 */
export function envFileProblem(path: string): string | null {
  if (!existsSync(path)) {
    return `${path} no existe: define las variables en el entorno o pasa --env con otra ruta.`;
  }
  try {
    accessSync(path, constants.R_OK);
    return null;
  } catch {
    return `${path} existe pero este usuario no puede leerlo (suele ser 600 de root): ejecuta la orden con sudo.`;
  }
}

/**
 * Vuelca en `target` las variables del fichero que aún no estén definidas y
 * devuelve cuántas ha añadido. Un fichero inexistente no es un error: un
 * portátil de desarrollo no lo tiene y el script debe seguir su curso.
 */
export function loadEnvFile(
  path: string,
  target: Record<string, string | undefined> = process.env,
): number {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return 0;
  }

  let applied = 0;
  for (const [key, value] of Object.entries(parseEnvFile(text))) {
    if (target[key] !== undefined) continue;
    target[key] = value;
    applied += 1;
  }
  return applied;
}
