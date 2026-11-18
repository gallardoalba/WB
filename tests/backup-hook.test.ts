/**
 * El gancho de copia externa no hereda los secretos del servicio.
 *
 * El comando del gancho lo elige quien administra, así que podría leer
 * cualquier cosa del entorno: la clave de cifrado, el token del mantenimiento o
 * el secreto del captcha. Se ejecuta con un entorno mínimo —el mismo que usa el
 * envoltorio de la imagen— y aquí se comprueba de verdad, ejecutando el script
 * con un gancho que vuelca lo que recibe.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";

const ejecutar = promisify(execFile);
const RAIZ = path.join(import.meta.dirname, "..");
const temporales: string[] = [];

afterEach(() => {
  for (const dir of temporales.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("el gancho ve la copia y nada más", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-hook-"));
  temporales.push(dir);
  const base = path.join(dir, "wanderbibliothek.db");
  const copias = path.join(dir, "copias");
  const volcado = path.join(dir, "entorno.txt");
  // Una base mínima: el script solo necesita que exista y que se pueda copiar.
  writeFileSync(base, "");

  await ejecutar(
    process.execPath,
    ["--import", "tsx", "scripts/backup.ts"],
    {
      cwd: RAIZ,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        // `ProcessEnv` exige `NODE_ENV` (la declara Next); el script no la usa.
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "/tmp",
        WANDERBIBLIOTHEK_DB: base,
        WANDERBIBLIOTHEK_BACKUP_DIR: copias,
        // Los tres secretos que no deben llegar al gancho.
        APP_ENCRYPTION_KEY: "a".repeat(64),
        MAINTENANCE_TOKEN: "token-que-no-debe-salir",
        TURNSTILE_SECRET: "secreto-que-no-debe-salir",
        WANDERBIBLIOTHEK_BACKUP_HOOK: `env > ${volcado}`,
      },
    },
  );

  const entorno = readFileSync(volcado, "utf8");
  assert.match(entorno, /^BACKUP_FILE=.*wanderbibliothek-.*\.db$/m, "el gancho recibe la copia");
  assert.match(entorno, /^PATH=/m, "y una ruta donde buscar las herramientas");

  for (const secreto of ["APP_ENCRYPTION_KEY", "MAINTENANCE_TOKEN", "TURNSTILE_SECRET"]) {
    assert.equal(
      entorno.includes(secreto),
      false,
      `${secreto} no puede llegar a un comando externo`,
    );
  }
});
