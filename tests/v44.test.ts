/**
 * Argumentos de `mail:test` y lectura del `EnvironmentFile` del servicio.
 *
 * Lo que se protege aquí es un diagnóstico: si el fichero se interpreta mal
 * (comillas, `export`, comentarios al final), o si el destinatario se pierde
 * por un índice mal calculado, `mail:test` responde «Uso: …» justo cuando la
 * orden era correcta.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvFile, parseEnvFile } from "../src/lib/env-file.ts";
import { parseMailTestArgs } from "../src/lib/mail-test-args.ts";

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

test("mail:test toma el destinatario cuando no hay --env", () => {
  // Regresión: `indiceEntorno + 1` valía 0 sin `--env` y descartaba el primer
  // argumento, así que una orden correcta acababa en el mensaje de uso.
  assert.deepEqual(parseMailTestArgs(["tu@correo.de"]), {
    destinatario: "tu@correo.de",
    entorno: "/etc/wanderbibliothek/env",
  });
});

test("mail:test acepta --env antes o después del destinatario", () => {
  assert.deepEqual(parseMailTestArgs(["tu@correo.de", "--env", "/tmp/otro"]), {
    destinatario: "tu@correo.de",
    entorno: "/tmp/otro",
  });
  assert.deepEqual(parseMailTestArgs(["--env", "/tmp/otro", "tu@correo.de"]), {
    destinatario: "tu@correo.de",
    entorno: "/tmp/otro",
  });
});

test("mail:test distingue un --env sin valor de un destinatario ausente", () => {
  assert.deepEqual(parseMailTestArgs(["tu@correo.de", "--env"]), {
    destinatario: "tu@correo.de",
    entorno: "",
  });
  assert.deepEqual(parseMailTestArgs([]), {
    destinatario: null,
    entorno: "/etc/wanderbibliothek/env",
  });
});
