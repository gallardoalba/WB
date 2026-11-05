/**
 * Vuelve a cifrar con la clave activa todo lo que quedó con una clave anterior
 * (o con el formato heredado `enc:v1:`).
 *
 * Sirve para completar una rotación:
 *
 *   # 1. La clave nueva va en APP_ENCRYPTION_KEY y la vieja en OLD_KEYS
 *   APP_ENCRYPTION_KEY=<nueva> APP_ENCRYPTION_OLD_KEYS=<vieja> \
 *     npm run rotate:secrets -- --dry-run
 *   # 2. Sin --dry-run, cuando el informe cuadre
 *   APP_ENCRYPTION_KEY=<nueva> APP_ENCRYPTION_OLD_KEYS=<vieja> \
 *     npm run rotate:secrets
 *   # 3. Ya se puede retirar APP_ENCRYPTION_OLD_KEYS
 *
 * Es idempotente: lo que ya está con la clave activa no se toca.
 */
import { getDb } from "../src/lib/db";
import {
  activeKeyId,
  decryptSecret,
  encryptSecret,
  isEncrypted,
  shipContext,
  totpContext,
} from "../src/lib/secret-box";

const dryRun = process.argv.includes("--dry-run");

const CAMPOS_ENVIO = [
  "ship_number",
  "ship_station",
  "ship_street",
  "ship_postal_code",
  "ship_city",
] as const;

function necesitaRotar(valor: string | null): boolean {
  if (!valor || !isEncrypted(valor)) return false;
  const id = activeKeyId();
  // `enc:v1:` nunca lleva id: hay que volver a cifrarlo con el formato actual.
  return !valor.startsWith(`enc:v2:${id}:`);
}

const db = getDb();
const activa = activeKeyId();
if (!activa) {
  console.error("Define APP_ENCRYPTION_KEY antes de rotar.");
  process.exit(1);
}

let pendientes = 0;
let rotados = 0;
const errores: string[] = [];

function rotar(
  etiqueta: string,
  valor: string,
  context: string,
  guardar: (nuevo: string) => void,
  leer: () => unknown,
): void {
  pendientes += 1;
  let claro: string;
  try {
    claro = decryptSecret(valor, context);
  } catch {
    // Puede ser un valor anterior al AAD: se prueba sin contexto.
    try {
      claro = decryptSecret(valor);
    } catch (error) {
      errores.push(`${etiqueta}: ${(error as Error).message}`);
      return;
    }
  }
  if (dryRun) {
    console.log(`[dry-run] ${etiqueta} → clave ${activa}`);
    return;
  }
  guardar(encryptSecret(claro, context));
  // Comprobación inmediata: lo que se escribe tiene que leerse.
  leer();
  rotados += 1;
}

// --- TOTP -------------------------------------------------------------------
const usuarios = db
  .prepare("SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL")
  .all() as { id: string; totp_secret: string }[];
const guardarTotp = db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?");
for (const usuario of usuarios) {
  if (!necesitaRotar(usuario.totp_secret)) continue;
  rotar(
    `totp:${usuario.id}`,
    usuario.totp_secret,
    totpContext(usuario.id),
    (nuevo) => guardarTotp.run(nuevo, usuario.id),
    () => {
      const fila = db
        .prepare("SELECT totp_secret FROM users WHERE id = ?")
        .get(usuario.id) as { totp_secret: string };
      decryptSecret(fila.totp_secret, totpContext(usuario.id));
    },
  );
}

// --- Datos de envío ---------------------------------------------------------
const solicitudes = db
  .prepare(`SELECT id, ${CAMPOS_ENVIO.join(", ")} FROM requests`)
  .all() as ({ id: string } & Record<(typeof CAMPOS_ENVIO)[number], string | null>)[];

for (const solicitud of solicitudes) {
  for (const campo of CAMPOS_ENVIO) {
    const valor = solicitud[campo];
    if (!valor || !necesitaRotar(valor)) continue;
    rotar(
      `${solicitud.id}.${campo}`,
      valor,
      shipContext(solicitud.id, campo),
      (nuevo) => db.prepare(`UPDATE requests SET ${campo} = ? WHERE id = ?`).run(nuevo, solicitud.id),
      () => {
        const fila = db
          .prepare(`SELECT ${campo} AS valor FROM requests WHERE id = ?`)
          .get(solicitud.id) as { valor: string };
        decryptSecret(fila.valor, shipContext(solicitud.id, campo));
      },
    );
  }
}

console.log(
  `Clave activa: ${activa}. ` +
    (dryRun
      ? `${pendientes} valores habría que rotar.`
      : `${rotados} de ${pendientes} valores rotados.`),
);
if (errores.length > 0) {
  console.error(`\n${errores.length} valores no se pudieron descifrar:`);
  for (const error of errores.slice(0, 20)) console.error(`  - ${error}`);
  console.error(
    "\nRevisa que APP_ENCRYPTION_OLD_KEYS tenga la clave con la que se cifraron antes de dar la rotación por terminada.",
  );
  process.exit(1);
}
