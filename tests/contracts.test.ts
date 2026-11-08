import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const API_DIR = path.join(process.cwd(), "src", "app", "api");
const MUTATION = /export async function (POST|PATCH|PUT|DELETE)\b/;

/** Rutas que se conforman con la guardia de origen (no necesitan cuota). */
const ORIGIN_ONLY = new Map([
  ["auth/logout/route.ts", "cerrar la propia sesión es idempotente y no admite abuso"],
]);

/** Rutas autenticadas por token, sin cookies: no hay CSRF posible. */
const TOKEN_ONLY = new Set(["cron/maintenance/route.ts"]);

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (entry.name === "route.ts") found.push(full);
  }
  return found;
}

test("toda mutación de la API pasa por guard() o, justificada, por assertSameOrigin()", () => {
  const offenders: string[] = [];
  for (const file of routeFiles(API_DIR)) {
    const relative = path.relative(API_DIR, file).split(path.sep).join("/");
    if (TOKEN_ONLY.has(relative)) continue;
    const source = readFileSync(file, "utf8");
    if (!MUTATION.test(source)) continue;

    if (ORIGIN_ONLY.has(relative)) {
      if (!source.includes("assertSameOrigin(")) offenders.push(`${relative} (falta origen)`);
      continue;
    }
    if (!source.includes("guard(")) offenders.push(`${relative} (falta guard)`);
  }
  assert.deepEqual(offenders, [], `Rutas sin proteger: ${offenders.join(", ")}`);
});

test("las excepciones documentadas siguen existiendo", () => {
  for (const file of [...ORIGIN_ONLY.keys(), ...TOKEN_ONLY]) {
    assert.ok(
      readFileSync(path.join(API_DIR, file), "utf8").length > 0,
      `La ruta exenta ${file} ya no existe: actualiza la lista`,
    );
  }
});

test("las rutas que leen cuerpo exigen JSON a través de readJson()", () => {
  const offenders: string[] = [];
  for (const file of routeFiles(API_DIR)) {
    const source = readFileSync(file, "utf8");
    if (!MUTATION.test(source)) continue;
    if (source.includes("request.json(") || source.includes("await request.formData")) {
      offenders.push(path.relative(API_DIR, file));
    }
  }
  assert.deepEqual(offenders, [], `Rutas que parsean el cuerpo a mano: ${offenders.join(", ")}`);
});

test("las rutas que leen la URL pública se renderizan por petición", () => {
  // El build no lleva entorno (CI y Docker compilan sin él), así que una ruta
  // prerenderizada evaluaría `siteUrl()` con el valor de reserva y publicaría
  // `http://localhost:3000` en el sitemap o en el canonical.
  for (const file of ["src/app/sitemap.ts", "src/app/robots.ts"]) {
    const source = readFileSync(path.join(process.cwd(), ...file.split("/")), "utf8");
    if (!source.includes("siteUrl(")) continue;
    assert.match(
      source,
      /await connection\(\)/,
      `${file} usa siteUrl() y debe llamar a connection() para no quedarse con la URL del build`,
    );
  }
});

test("ninguna prueba escribe en la base de desarrollo", () => {
  // Pasó una vez: un archivo de pruebas se olvidó de `WANDERBIBLIOTHEK_DB` y
  // `getDb()` abrió `.data/wanderbibliothek.db`. La prueba «pasaba» la primera
  // vez y fallaba en la segunda, y por el camino creó una cuenta y cambió roles
  // en la base de quien estaba desarrollando. Quien toca la base lo declara.
  const directorio = path.join(process.cwd(), "tests");
  const offenders: string[] = [];
  // Solo cuentan los módulos que abren la conexión: `migrations.ts` o
  // `schema.ts` se usan con una base propia (`new Database(":memory:")`).
  const CONEXION = /(?:from|import\()\s*"\.\.\/src\/lib\/(?:repo|db\/index)(?:\.ts)?"/;
  for (const nombre of readdirSync(directorio)) {
    if (!nombre.endsWith(".test.ts")) continue;
    const source = readFileSync(path.join(directorio, nombre), "utf8");
    if (!CONEXION.test(source)) continue;
    if (!/WANDERBIBLIOTHEK_DB\s*=/.test(source)) offenders.push(nombre);
  }
  assert.deepEqual(
    offenders,
    [],
    `Estas pruebas deben fijar WANDERBIBLIOTHEK_DB (:memory: o un fichero temporal): ${offenders.join(", ")}`,
  );
});
