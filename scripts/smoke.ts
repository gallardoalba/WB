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
  // Sin este id no se puede unir lo que ve una persona con la traza del registro.
  const requestId = home.headers.get("x-request-id");
  record(
    "Id de petición en la respuesta",
    Boolean(requestId && requestId.length >= 8),
    requestId ?? "ausente",
  );
  const api = await expectStatus("/api/notifications", 401);
  record(
    "El id acompaña también a los errores de la API",
    Boolean(api.headers.get("x-request-id")),
    api.headers.get("x-request-id") ?? "ausente",
  );

  await expectStatus("/robots.txt", 200);
  await expectStatus("/sitemap.xml", 200);
  await expectStatus("/api/health", 200);
  // Páginas legales: sin ellas el servicio no debería abrirse al público.
  await expectStatus("/privacidad", 200);
  const privacy = await expectStatus("/aviso-legal", 200);
  const legalHtml = await privacy.text();
  record(
    "Datos del responsable configurados",
    !legalHtml.includes("legal-warning"),
    legalHtml.includes("legal-warning")
      ? "falta LEGAL_CONTROLLER / LEGAL_ADDRESS / LEGAL_CONTACT_EMAIL"
      : "aviso legal completo",
  );
  record(
    "CSP sin imágenes de terceros",
    !/img-src[^;]*https?:/.test(csp),
    /img-src[^;]*https?:/.test(csp) ? "hay orígenes externos en img-src" : "solo el propio origen",
  );
  // Sin sesión, /admin puede responder 404/307 o una «cáscara» 200 con la
  // redirección en el flujo RSC: lo que no puede es servir el panel.
  const admin = await expectStatus("/admin", [307, 404, 200]);
  if (admin.status === 200) {
    const html = await admin.text();
    record(
      "/admin sin sesión redirige al acceso",
      html.includes("next=%2Fadmin"),
      html.includes("next=%2Fadmin") ? "redirección presente" : "sin marca de redirección",
    );
  }
  await expectStatus("/api/account/export", 401);

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
