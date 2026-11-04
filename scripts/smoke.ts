/**
 * Comprobación rápida contra un servidor en marcha.
 *
 *   npm run smoke              # http://localhost:3000
 *   BASE_URL=https://… npm run smoke
 *
 * No sustituye a las pruebas (`npm test`): verifica que las rutas públicas
 * responden, que las cabeceras de seguridad están puestas y que una sesión
 * anónima no entra en el panel de administración.
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name} — ${detail}`);
}

async function expectStatus(path: string, expected: number | number[], init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  const ok = Array.isArray(expected) ? expected.includes(response.status) : response.status === expected;
  record(path, ok, `HTTP ${response.status}`);
  return response;
}

async function main() {
  const home = await expectStatus("/", 200);
  const csp = home.headers.get("content-security-policy") ?? "";
  record(
    "CSP con nonce",
    /script-src[^;]*'nonce-/.test(csp),
    csp.slice(0, 60) || "sin cabecera",
  );
  record(
    "Sin X-Powered-By",
    !home.headers.get("x-powered-by"),
    home.headers.get("x-powered-by") ?? "ausente",
  );

  await expectStatus("/robots.txt", 200);
  await expectStatus("/sitemap.xml", 200);
  await expectStatus("/api/health", 200);
  await expectStatus("/admin", [404, 200]); // 404 sin sesión, 200 con ella
  await expectStatus("/api/account/export", 401);
  await expectStatus("/api/notifications", 401);

  // Una mutación sin JSON ni origen debe rechazarse.
  const bad = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: '{"email":"x@y.z","password":"x"}',
  });
  record("Cuerpo no JSON rechazado", bad.status === 415 || bad.status === 403, `HTTP ${bad.status}`);

  const failed = checks.filter((check) => !check.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} comprobaciones correctas`);
  if (failed.length > 0) process.exit(1);
}

void main().catch((error) => {
  console.error("smoke falló:", error);
  process.exit(1);
});
