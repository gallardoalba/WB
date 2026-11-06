/**
 * Envía un correo de prueba con el proveedor configurado. No toca la base.
 *
 *   sudo -u wanderbibliothek npm --prefix /srv/wanderbibliothek/current run mail:test -- tu@correo
 *
 * Existe para comprobar una clave de Brevo (o un webhook) recién puesta sin
 * esperar a que alguien se registre; si esto llega, el resto del flujo —la
 * cola, los enlaces de un solo uso— también funciona.
 *
 * El entorno se toma de `/etc/wanderbibliothek/env` (el mismo fichero que lee
 * systemd) para lo que no venga ya exportado; con `--env` se puede apuntar a
 * otro fichero.
 */
import { loadEnvFile } from "../src/lib/env-file";
import { parseMailTestArgs } from "../src/lib/mail-test-args";
import { sendMail } from "../src/lib/mailer";

const { destinatario, entorno: ficheroEntorno } = parseMailTestArgs(process.argv.slice(2));

if (!ficheroEntorno) {
  console.error("Uso: npm run mail:test -- tu@correo [--env /ruta/al/entorno]");
  process.exit(1);
}

const leidas = loadEnvFile(ficheroEntorno);
if (leidas > 0) console.log(`Entorno leído de ${ficheroEntorno}.`);

if (!destinatario || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
  console.error("Uso: npm run mail:test -- tu@correo [--env /ruta/al/entorno]");
  process.exit(1);
}

const proveedor = process.env.MAIL_WEBHOOK_URL?.trim()
  ? `webhook (${process.env.MAIL_WEBHOOK_URL})`
  : process.env.BREVO_API_KEY?.trim()
    ? "Brevo"
    : null;

if (!proveedor) {
  console.error(
    "No hay proveedor configurado: define BREVO_API_KEY y MAIL_FROM (o MAIL_WEBHOOK_URL),\n" +
      `o comprueba que ${ficheroEntorno} contiene esas líneas (con --env se puede apuntar a otro fichero).`,
  );
  process.exit(1);
}

// Sin esto, en un entorno sin NODE_ENV=production el fallo acabaría en
// `.data/outbox/` y el script diría que todo ha ido bien. `process.env.NODE_ENV`
// se declara de solo lectura, de ahí el `Object.assign`.
Object.assign(process.env, { NODE_ENV: "production" });

async function main() {
  console.log(`Enviando a ${destinatario} por ${proveedor}…`);

  const { delivered } = await sendMail({
    to: destinatario!,
    subject: "Wanderbibliothek: correo de prueba",
    text:
      "Si lees esto, el proveedor de correo está bien configurado.\n\n" +
      "No hay que hacer nada más: es un mensaje de prueba enviado a mano.",
  });

  if (delivered) {
    console.log("Aceptado por el proveedor. Revisa la bandeja (y el spam la primera vez).");
    process.exit(0);
  }

  console.error(
    "El proveedor no confirmó la entrega: el motivo está en la línea «[mail]» de arriba.",
  );
  process.exit(1);
}

void main();
