/**
 * Los ficheros de libolm que se sirven son los que el paquete declara.
 *
 * `scripts/olm-assets.ts` los copia a `public/olm` para cargarlos en tiempo de
 * ejecución. Si un fichero de `node_modules` estuviera alterado —una descarga
 * manipulada, un `postinstall` ajeno—, el navegador ejecutaría ese código con
 * acceso a las claves. El script compara con `checksums.txt` y esta prueba fija
 * que la comprobación existe y que hoy cuadra.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const origin = path.dirname(require.resolve("@matrix-org/olm/olm.js"));

function declared(): Map<string, string> {
  const file = path.join(origin, "checksums.txt");
  const hashes = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) hashes.set(match[2]!.trim(), match[1]!);
  }
  return hashes;
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

test("los ficheros de libolm que se sirven coinciden con su checksum", () => {
  const hashes = declared();
  for (const file of ["olm.js", "olm.wasm"]) {
    const expected = hashes.get(file);
    assert.ok(expected, `checksums.txt no declara ${file}`);
    assert.equal(sha256(path.join(origin, file)), expected, `${file} no coincide`);
  }
});

test("el paquete no añade ficheros nuevos sin que nos enteremos", () => {
  // Se sirven `olm.js` y `olm.wasm`; `olm_legacy.js` existe pero no se usa. Si
  // una versión futura trae otro `.js` o `.wasm` —un worker, un `.data`—,
  // servirlo sin comprobarlo dejaría un hueco: esto obliga a mirarlo.
  const declarados = [...declared().keys()].filter((name) => /\.(js|wasm)$/.test(name)).sort();
  assert.deepEqual(declarados, ["olm.js", "olm.wasm", "olm_legacy.js"]);
});
