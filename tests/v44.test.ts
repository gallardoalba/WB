/**
 * Lectura del `EnvironmentFile` del servicio para los scripts de operación.
 *
 * Lo que se protege aquí es un diagnóstico: si el fichero se interpreta mal
 * (comillas, `export`, comentarios al final), `mail:test` dirá «no hay
 * proveedor configurado» justo cuando la clave sí está puesta.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvFile, parseEnvFile } from "../src/lib/env-file.ts";

function ficheroTemporal(contenido: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wanderbibliothek-env-"));
  const file = path.join(dir, "env");
  writeFileSync(file, contenido, { mode: 0o600 });
  return file;
}

test("interpreta comillas, export y comentarios", () => {
  const valores = parseEnvFile(
    [
      "# Entorno del servicio",
      "; también vale el punto y coma",
      "",
      "NEXT_PUBLIC_SITE_URL=https://wanderbibliothek.org",
      'MAIL_FROM="Wanderbibliothek <no-reply@wanderbibliothek.org>"',
      "export BREVO_API_KEY='xkeysib-abc'",
      "TRUST_PROXY=1   # detrás de nginx",
      "VACIA=",
    ].join("\n"),
  );

  assert.deepEqual(valores, {
    NEXT_PUBLIC_SITE_URL: "https://wanderbibliothek.org",
    MAIL_FROM: "Wanderbibliothek <no-reply@wanderbibliothek.org>",
    BREVO_API_KEY: "xkeysib-abc",
    TRUST_PROXY: "1",
    VACIA: "",
  });
});

test("un # pegado al valor no abre comentario", () => {
  // Las claves y las contraseñas llevan `#` sin espacio delante.
  assert.deepEqual(parseEnvFile("ADMIN_PASSWORD=se#creto"), { ADMIN_PASSWORD: "se#creto" });
});

test("ignora líneas rotas como hace systemd", () => {
  const valores = parseEnvFile("=sin-clave\nLÍNEA SUELTA\nOK=1\n");
  assert.deepEqual(valores, { OK: "1" });
});

test("no pisa lo que ya está exportado en el proceso", () => {
  const file = ficheroTemporal("BREVO_API_KEY=xkeysib-del-fichero\nMAIL_FROM=avisos@wanderbibliothek.org\n");
  const destino: Record<string, string | undefined> = { BREVO_API_KEY: "xkeysib-exportada" };

  assert.equal(loadEnvFile(file, destino), 1, "solo se añade la que faltaba");
  assert.equal(destino.BREVO_API_KEY, "xkeysib-exportada");
  assert.equal(destino.MAIL_FROM, "avisos@wanderbibliothek.org");
});

test("un fichero inexistente no es un error", () => {
  const destino: Record<string, string | undefined> = {};
  assert.equal(loadEnvFile("/no/existe/wanderbibliothek/env", destino), 0);
  assert.deepEqual(destino, {});
});
