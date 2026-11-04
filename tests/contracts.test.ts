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
