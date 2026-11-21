/**
 * Copia libolm a `public/olm` para cargarlo en el navegador, comprobando los
 * hashes que publica el propio paquete.
 *
 * El paquete de `@matrix-org/olm` es un binario de Emscripten que trae ramas
 * para Node (`require("fs")`, `require("path")`): si se importa desde el código
 * de la interfaz, el empaquetador intenta resolverlas y falla, porque solo
 * existen en el servidor. La salida es la de siempre con WASM: servir los
 * ficheros tal cual y cargarlos en tiempo de ejecución.
 *
 * `checksums.txt` viene dentro del paquete (y con su firma GPG al lado). Aquí se
 * comprueba que lo que se copia es exactamente lo que el paquete declara: un
 * fichero alterado en `node_modules` no llega al navegador sin que el build
 * falle.
 *
 * Se ejecuta antes de `dev` y de `build`; lo copiado no se versiona.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const origin = path.dirname(require.resolve("@matrix-org/olm/olm.js"));
const target = path.join(process.cwd(), "public", "olm");

/** Hashes que el paquete declara para sus ficheros: `<sha256>  <nombre>`. */
function expectedHashes(): Map<string, string> {
  const file = path.join(origin, "checksums.txt");
  const expected = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) expected.set(match[2]!.trim(), match[1]!);
  }
  return expected;
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

const expected = expectedHashes();
mkdirSync(target, { recursive: true });

const copied: Record<string, string> = {};
for (const file of ["olm.js", "olm.wasm"]) {
  const source = path.join(origin, file);
  const digest = sha256(source);
  const declared = expected.get(file);
  if (!declared) {
    throw new Error(
      `El paquete de libolm no declara el hash de ${file}: no se copia nada. Revisa la versión de @matrix-org/olm.`,
    );
  }
  if (declared !== digest) {
    throw new Error(
      `El hash de ${file} no coincide con el que publica el paquete.\n  declarado: ${declared}\n  obtenido:  ${digest}\nNo se copia: puede ser una descarga alterada.`,
    );
  }
  copyFileSync(source, path.join(target, file));
  copied[file] = digest;
}

// Queda junto a los ficheros para poder comprobar de un vistazo qué se sirve.
writeFileSync(path.join(target, "integrity.json"), `${JSON.stringify({ sha256: copied }, null, 2)}\n`);

console.log(`libolm copiado y verificado en ${path.relative(process.cwd(), target)}`);
