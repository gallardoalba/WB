/**
 * Genera una clave Ed25519 para firmar las instantáneas de transparencia.
 *
 *   npm run transparency:key
 *
 * La clave privada se imprime una sola vez, en PKCS#8 base64, que es el
 * formato que espera `TRANSPARENCY_SIGNING_KEY`. Guardarla en el gestor de
 * secretos del despliegue: si se pierde, las instantáneas nuevas dejan de ser
 * comparables con las viejas y hay que republicar la huella pública.
 */
import { createPrivateKey, generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
const base64 = Buffer.from(pkcs8).toString("base64");

// Se vuelve a leer para no imprimir algo que el arranque luego rechace.
const comprobada = createPrivateKey({ key: Buffer.from(base64, "base64"), format: "der", type: "pkcs8" });
if (comprobada.asymmetricKeyType !== "ed25519") {
  console.error("La clave generada no es Ed25519; no se publica.");
  process.exit(1);
}

console.log("TRANSPARENCY_SIGNING_KEY=" + base64);
console.log();
console.log("# Añádela al entorno del servicio y arranca con REQUIRE_TRANSPARENCY_SIGNING=1");
console.log("# para que una instalación sin firma no pase la comprobación de arranque.");
