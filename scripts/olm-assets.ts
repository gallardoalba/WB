/**
 * Copia libolm a `public/olm` para cargarlo en el navegador.
 *
 * El paquete de `@matrix-org/olm` es un binario de Emscripten que trae ramas
 * para Node (`require("fs")`, `require("path")`): si se importa desde el
 * código de la interfaz, el empaquetador intenta resolverlas y falla, porque
 * solo existen en el servidor. La salida es la de siempre con WASM: servir los
 * ficheros tal cual y cargarlos en tiempo de ejecución.
 *
 * Se ejecuta antes de `dev` y de `build`; lo copiado no se versiona.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const origin = path.dirname(require.resolve("@matrix-org/olm/olm.js"));
const target = path.join(process.cwd(), "public", "olm");

mkdirSync(target, { recursive: true });
for (const file of ["olm.js", "olm.wasm"]) {
  copyFileSync(path.join(origin, file), path.join(target, file));
}
console.log(`libolm copiado a ${path.relative(process.cwd(), target)}`);
