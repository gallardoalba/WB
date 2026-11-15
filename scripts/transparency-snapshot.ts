/**
 * Crea una instantánea firmada del catálogo público.
 *
 *   npm run transparency:snapshot                 # la hora y la clave del entorno
 *   TRANSPARENCY_SIGNING_KEY=… npm run transparency:snapshot
 *
 * El cron de mantenimiento ya crea una al día; esto existe para forzarla justo
 * después de un despliegue o para probar la verificación. Sin clave, la
 * instantánea se guarda sin firma y el comando lo avisa: sigue sirviendo para
 * comparar contenido, no como prueba criptográfica.
 */
import { getDb } from "../src/lib/db/index";
import { createSnapshot, signingKey } from "../src/lib/transparency";

const key = signingKey();
const snapshot = createSnapshot(getDb(), { key });

console.log(JSON.stringify(snapshot, null, 2));
if (!key) {
  console.warn(
    "\nAviso: no hay TRANSPARENCY_SIGNING_KEY (Ed25519). La instantánea no está firmada.",
  );
}
