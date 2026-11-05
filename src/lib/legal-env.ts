/**
 * Formato del bloque de variables legales.
 *
 * Vive aparte del CLI para poder probarlo: el script solo parsea argumentos y
 * escribe el fichero. El objetivo es que rellenar `/etc/wanderbibliothek/env`
 * sea un comando y no una edición a mano donde un `$` o unas comillas rompan el
 * `EnvironmentFile` de systemd.
 */

export type LegalValues = {
  controller?: string;
  address?: string;
  contact?: string;
  register?: string;
  vatId?: string;
  phone?: string;
};

export const LEGAL_KEYS = [
  "LEGAL_CONTROLLER",
  "LEGAL_ADDRESS",
  "LEGAL_CONTACT_EMAIL",
  "LEGAL_REGISTER",
  "LEGAL_VAT_ID",
  "LEGAL_PHONE",
] as const;

/** Un `EnvironmentFile` es una línea por variable: ni saltos ni comillas. */
function safeValue(value: string): boolean {
  return !/[\n\r"]/.test(value);
}

/**
 * Devuelve los problemas que impiden publicar las páginas legales. Los tres
 * primeros campos son obligatorios; el resto, opcionales.
 */
export function validateLegalValues(values: LegalValues): string[] {
  const problems: string[] = [];
  const required: [keyof LegalValues, string][] = [
    ["controller", "el nombre o razón social"],
    ["address", "la dirección completa"],
    ["contact", "el correo de contacto"],
  ];
  for (const [field, label] of required) {
    if (!values[field]?.trim()) problems.push(`Falta ${label}.`);
  }
  for (const [field, value] of Object.entries(values)) {
    if (value && !safeValue(value)) {
      problems.push(`El valor de ${field} no puede contener saltos de línea ni comillas.`);
    }
  }
  const contact = values.contact?.trim() ?? "";
  if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    problems.push("El correo de contacto no parece una dirección válida.");
  }
  return problems;
}

/** Bloque listo para pegar en el `EnvironmentFile` del servicio. */
export function formatLegalEnv(values: LegalValues): string {
  const lines = [
    "# Datos del responsable (Impressum § 5 DDG y art. 13 RGPD).",
    "# Rellenos con `npm run legal:env -- --help`.",
  ];
  const pairs: [string, string | undefined][] = [
    ["LEGAL_CONTROLLER", values.controller],
    ["LEGAL_ADDRESS", values.address],
    ["LEGAL_CONTACT_EMAIL", values.contact],
    ["LEGAL_REGISTER", values.register],
    ["LEGAL_VAT_ID", values.vatId],
    ["LEGAL_PHONE", values.phone],
  ];
  for (const [key, value] of pairs) {
    if (value?.trim()) lines.push(`${key}="${value.trim()}"`);
  }
  return lines.join("\n");
}

/**
 * Sustituye las líneas `LEGAL_*` del fichero de entorno y añade las nuevas.
 * El resto del fichero (secretos, rutas) no se toca.
 */
export function replaceLegalEnv(existing: string, block: string): string {
  const kept = existing
    .split("\n")
    .filter((line) => !LEGAL_KEYS.some((key) => line.trimStart().startsWith(`${key}=`)))
    // Quita el comentario de cabecera que genera `formatLegalEnv` si ya estaba.
    .filter((line) => !line.startsWith("# Datos del responsable"))
    .filter((line) => !line.startsWith("# Rellenos con `npm run legal:env"));
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === "") kept.pop();
  return `${kept.join("\n")}\n\n${block}\n`;
}
