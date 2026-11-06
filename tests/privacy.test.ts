import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type DbModule = typeof import("../src/lib/db/index.ts");
type ThrottleModule = typeof import("../src/lib/throttle.ts");
type TextModule = typeof import("../src/lib/text.ts");
type ValidationModule = typeof import("../src/lib/validation.ts");
type LegalModule = typeof import("../src/lib/legal.ts");
type LegalEnvModule = typeof import("../src/lib/legal-env.ts");

let dbModule: DbModule;
let throttle: ThrottleModule;
let text: TextModule;
let validation: ValidationModule;
let legal: LegalModule;
let legalEnv: LegalEnvModule;

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  throttle = await import("../src/lib/throttle.ts");
  text = await import("../src/lib/text.ts");
  validation = await import("../src/lib/validation.ts");
  legal = await import("../src/lib/legal.ts");
  legalEnv = await import("../src/lib/legal-env.ts");
});

const source = (relative: string) =>
  readFileSync(path.join(process.cwd(), ...relative.split("/")), "utf8");

/**
 * Estas tres comprobaciones no prueban lógica propia: fijan decisiones de
 * privacidad que son fáciles de deshacer sin querer en un cambio futuro.
 */

test("el borrado de filas no deja el contenido en el fichero SQLite", () => {
  // Sin `secure_delete`, SQLite marca la página como libre pero no la borra:
  // los datos de una cuenta eliminada seguirían legibles en el .db.
  assert.equal(dbModule.getDb().pragma("secure_delete", { simple: true }), 1);
});

test("robots.txt no invita a indexar el catálogo ni los perfiles", () => {
  const robots = source("src/app/robots.ts");
  for (const route of ["/descubrir", "/u/", "/libro/", "/obra/", "/lectores"]) {
    assert.ok(
      robots.includes(`"${route}"`),
      `robots.ts debería vetar ${route}: expone nombre y ciudad de lectores`,
    );
  }
});

test("la CSP no autoriza ningún origen externo de imágenes", () => {
  const proxy = source("src/proxy.ts");
  const imgSrc = /"img-src ([^"]+)"/.exec(proxy)?.[1] ?? "";
  const origins = imgSrc.split(/\s+/).filter((value) => /^https?:|^\/\//.test(value));
  // Cada host de `img-src` recibe la IP de quien navega y qué está mirando.
  assert.deepEqual(origins, [], `orígenes externos en img-src: ${origins.join(", ")}`);
});

test("las portadas se piden a la propia aplicación, nunca a un tercero", () => {
  assert.equal(text.coverFromIsbn("9788420412146"), "/api/cover/9788420412146");
  assert.equal(text.coverFromIsbn(null), null);
  // Las URL externas ya guardadas en la base se migran (v29).
  assert.match(source("src/lib/db/migrations.ts"), /cover_url LIKE 'https:\/\/covers\.openlibrary\.org\//);
});

test("el limitador guarda un pseudónimo diario, no la dirección IP", () => {
  const first = throttle.pseudonymizeIp("203.0.113.7");
  assert.equal(first, throttle.pseudonymizeIp("203.0.113.7"), "la misma IP, la misma clave");
  assert.notEqual(first, "203.0.113.7", "no se guarda la IP en claro");
  assert.notEqual(first, throttle.pseudonymizeIp("203.0.113.8"), "dos IP no colisionan");
  assert.equal(throttle.pseudonymizeIp("direct"), "direct");
});

test("sin proxy de confianza no se guarda ninguna dirección", () => {
  const previous = process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY;
  try {
    const key = throttle.clientKeyFrom((name) =>
      name === "x-forwarded-for" ? "198.51.100.4" : null,
    );
    assert.equal(key, "direct");
  } finally {
    if (previous !== undefined) process.env.TRUST_PROXY = previous;
  }
});

test("el registro exige declarar 16 años o más", () => {
  const base = {
    name: "Lectora",
    email: "lectora@example.com",
    password: "unaClaveLarga123",
    city: "Stuttgart",
    website: "",
    startedAt: Date.now() - 5_000,
  };
  assert.equal(validation.registerSchema.safeParse(base).success, false);
  assert.equal(
    validation.registerSchema.safeParse({ ...base, ageConfirmed: false }).success,
    false,
  );
  assert.equal(validation.registerSchema.safeParse({ ...base, ageConfirmed: true }).success, true);
});

test("las páginas legales avisan en vez de inventar los datos del responsable", () => {
  const empty = legal.legalConfig({});
  assert.equal(empty.complete, false);
  assert.match(legal.privacyDocument("es", empty).sections[0]!.body.join(" "), /LEGAL_CONTROLLER/);

  const configured = legal.legalConfig({
    LEGAL_CONTROLLER: "Equipo",
    LEGAL_ADDRESS: "Calle 1",
    LEGAL_CONTACT_EMAIL: "privacidad@example.com",
  });
  assert.equal(configured.complete, true);
  assert.match(
    legal.privacyDocument("de", configured).sections[0]!.body.join(" "),
    /privacidad@example\.com/,
  );
});

test("la política declara lo que hace la app, no lo que sería cómodo declarar", () => {
  const config = legal.legalConfig({});
  const text = legal.privacyDocument("es", config)
    .sections.flatMap((section) => section.body)
    .join(" ");
  // Son dos cookies (sesión e idioma), no una: así estaba mal antes.
  assert.match(text, /Dos cookies técnicas/);
  assert.match(text, /cookies? de idioma?[^.]*1 año|idioma \(1 año\)/);
  // Elementos exigidos por el art. 13 RGPD.
  for (const required of [
    "Transferencias internacionales",
    "Limitación del tratamiento",
    "Retirada del consentimiento",
    "decisiones automatizadas",
    "Reclamación",
  ]) {
    assert.ok(text.includes(required), `la política no menciona «${required}»`);
  }
});

test("el ayudante de datos legales valida y no rompe el EnvironmentFile", () => {
  // Los tres primeros son obligatorios.
  const missing = legalEnv.validateLegalValues({ controller: "X" });
  assert.equal(missing.length, 2);

  const invalid = legalEnv.validateLegalValues({
    controller: "X",
    address: "Calle 1",
    contact: "no-es-un-correo",
  });
  assert.match(invalid.join(" "), /correo/);

  // Un valor con comillas o salto rompería el fichero de systemd.
  const unsafe = legalEnv.validateLegalValues({
    controller: 'Nombre "raro"',
    address: "Calle 1\nSegunda línea",
    contact: "a@b.example",
  });
  assert.equal(unsafe.length, 2);

  const block = legalEnv.formatLegalEnv({
    controller: "Equipo e.V.",
    address: "Hauptstr. 1, 70173 Stuttgart",
    contact: "privacidad@example.org",
    phone: "",
  });
  assert.match(block, /^LEGAL_CONTROLLER="Equipo e\.V\."$/m);
  assert.match(block, /^LEGAL_CONTACT_EMAIL="privacidad@example\.org"$/m);
  // Un campo vacío no se escribe: una variable vacía no aporta nada.
  assert.equal(block.includes("LEGAL_PHONE"), false);
});

test("escribir los datos legales respeta el resto del fichero de entorno", () => {
  const existing = [
    "NEXT_PUBLIC_SITE_URL=https://x.example",
    'LEGAL_CONTROLLER="Viejo"',
    "MAINTENANCE_TOKEN=abc",
    "",
  ].join("\n");
  const block = legalEnv.formatLegalEnv({
    controller: "Nuevo",
    address: "Calle 2",
    contact: "privacidad@example.org",
  });
  const result = legalEnv.replaceLegalEnv(existing, block);
  assert.match(result, /^NEXT_PUBLIC_SITE_URL=https:\/\/x\.example$/m);
  assert.match(result, /^MAINTENANCE_TOKEN=abc$/m);
  assert.match(result, /^LEGAL_CONTROLLER="Nuevo"$/m);
  // El valor anterior no se duplica.
  assert.equal(result.includes('LEGAL_CONTROLLER="Viejo"'), false);
});

test("los enlaces de un solo uso van en la query, y ni el registro ni el Referer los recogen", async () => {
  const tokens = await import("../src/lib/account-tokens.ts");
  await tokens.sendPasswordResetEmail("usr_ana", "ana@wanderbibliothek.test");
  const row = dbModule
    .getDb()
    .prepare("SELECT body FROM mail_outbox ORDER BY created_at DESC LIMIT 1")
    .get() as { body: string };
  // En el fragmento el enlace no sobrevivía: el redireccionador del proveedor
  // de correo cortaba el `#` y el clic llegaba a /restablecer sin token.
  assert.match(row.body, /\/restablecer\?token=[a-f0-9]{64}/);
  assert.equal(row.body.includes("#token="), false);

  // Que no acabe en el registro se sostiene en dos piezas, no en la suerte:
  // nginx anota `$uri` (sin la query)…
  assert.match(source("deploy/nginx.conf"), /\$request_method \$uri \$server_protocol/);
  // …y las dos páginas que lo reciben no mandan referente.
  const proxy = source("src/proxy.ts");
  assert.match(proxy, /no-referrer/);
  assert.match(proxy, /"\/verificar"/);
  assert.match(proxy, /"\/restablecer"/);
});

test("un flujo en vivo por pestaña: se cortan las conexiones simultáneas de más", async () => {
  const live = await import("../src/lib/live.ts");
  assert.equal(live.acquireStream("usr_ana"), true);
  assert.equal(live.acquireStream("usr_ana"), true);
  assert.equal(live.acquireStream("usr_ana"), true);
  assert.equal(live.acquireStream("usr_ana"), false, "la cuarta no se admite");
  // Otra cuenta no se ve afectada.
  assert.equal(live.acquireStream("usr_clara"), true);
  live.releaseStream("usr_ana");
  assert.equal(live.acquireStream("usr_ana"), true, "al cerrar una pestaña se libera");
  for (let index = 0; index < 4; index += 1) live.releaseStream("usr_ana");
  assert.equal(live.acquireStream("usr_ana"), true, "liberar de más no deja el contador negativo");
});
