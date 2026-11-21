import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { SCHEMA_VERSION } from "../src/lib/db/schema.ts";

const API_DIR = path.join(process.cwd(), "src", "app", "api");
const MUTATION = /export async function (POST|PATCH|PUT|DELETE)\b/;

/** Rutas que se conforman con la guardia de origen (no necesitan cuota). */
const ORIGIN_ONLY = new Map([
  ["auth/logout/route.ts", "cerrar la propia sesión es idempotente y no admite abuso"],
]);

/** Rutas autenticadas por token, sin cookies: no hay CSRF posible. */
const TOKEN_ONLY = new Set(["cron/maintenance/route.ts"]);

/**
 * Handlers que aún no pasan por `route()`. Solo puede bajar: una ruta nueva que
 * se escriba a mano rompe la prueba, y envolver una existente deja margen para
 * bajar el tope. Completa la migración sin exigir un cambio de golpe.
 */
const MANUAL_HANDLERS = 88;

/**
 * Ficheros con handlers a mano que tampoco llaman a `recordRequest()`. Solo
 * puede bajar: una ruta nueva sin `route()` ni registro rompe la prueba.
 */
const UNLOGGED_ROUTE_FILES = 66;

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

test("la migración a route() no retrocede", () => {
  let manual = 0;
  for (const file of routeFiles(API_DIR)) {
    const source = readFileSync(file, "utf8");
    const handlers = source.match(/^export (?:const|async function) (?:GET|POST|PUT|PATCH|DELETE)\b/gm);
    const wrapped = source.match(/^export const (?:GET|POST|PUT|PATCH|DELETE) = route[<(]/gm);
    manual += (handlers?.length ?? 0) - (wrapped?.length ?? 0);
  }
  assert.ok(
    manual <= MANUAL_HANDLERS,
    `Quedan ${manual} handlers fuera de route() (tope ${MANUAL_HANDLERS}): una ruta nueva debe usar el envoltorio; si has envuelto alguna, baja el tope`,
  );
});

test("ninguna ruta nueva se queda sin registro de petición", () => {
  // `route()` ya llama a `recordRequest()`. Las que siguen a mano deben
  // hacerlo ellas; hasta completar la migración, el tope es lo que impide que
  // la deuda crezca.
  const handlers = /^export (?:const|async function) (?:GET|POST|PUT|PATCH|DELETE)\b/m;
  const wrapped = /^export const (?:GET|POST|PUT|PATCH|DELETE) = route[<(]/m;
  const unlogged = routeFiles(API_DIR).filter((file) => {
    const source = readFileSync(file, "utf8");
    if (!handlers.test(source) || wrapped.test(source)) return false;
    return !source.includes("recordRequest(");
  });
  assert.ok(
    unlogged.length <= UNLOGGED_ROUTE_FILES,
    `Hay ${unlogged.length} ficheros sin route() ni recordRequest() (tope ${UNLOGGED_ROUTE_FILES}): ${unlogged.join(", ")}`,
  );
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

test("la cuenta de Mastodon se declara con rel=me en el encabezado", () => {
  // Mastodon da por verificada una cuenta si la página a la que apunta su
  // enlace devuelve un `rel="me"` hacia el perfil, y lo comprueba sobre el HTML
  // servido: sin ejecutar JavaScript. Va en <head>, así que no se ve ni ocupa
  // sitio en la interfaz.
  const layout = readFileSync(path.join(process.cwd(), "src", "app", "layout.tsx"), "utf8");
  const head = /<head>([\s\S]*?)<\/head>/.exec(layout)?.[1] ?? "";
  assert.match(
    head,
    /<link[^>]*rel="me"[^>]*href=\{MASTODON\}/,
    "el <link rel=\"me\"> tiene que estar dentro de <head> y apuntar a MASTODON",
  );

  const brand = readFileSync(path.join(process.cwd(), "src", "lib", "brand.ts"), "utf8");
  const perfil = /export const MASTODON = "([^"]+)"/.exec(brand)?.[1] ?? "";
  assert.equal(
    perfil,
    "https://mastodon.social/@wanderbibliothek",
    "el perfil declarado tiene que ser la cuenta real del fediverso",
  );
});

test("los dos pies de página enlazan a la cuenta de Mastodon", () => {
  // Hay dos pies: el del catálogo (`wanderbibliothek-app`) y el del resto de
  // páginas (`site-shell`). El enlace se me quedó solo en uno y la portada no
  // lo enseñaba; ahora los dos montan el mismo componente.
  for (const file of [
    "src/components/wanderbibliothek-app.tsx",
    "src/components/site-shell.tsx",
  ]) {
    const source = readFileSync(path.join(process.cwd(), ...file.split("/")), "utf8");
    assert.match(source, /<MastodonLink\s*\/>/, `${file} debe incluir <MastodonLink />`);
  }
});

test("la documentación declara el rango de migraciones que hay de verdad", () => {
  // El número se quedó en v46 cuando el código ya iba por la v48: en vez de
  // confiar en acordarse, la cadena que se publica se comprueba contra
  // `SCHEMA_VERSION`.
  const esperado = `v3–v${SCHEMA_VERSION}`;
  const desfasados = ["DOCUMENTATION.md", "src/lib/technical.ts", "src/lib/technical-en.ts"]
    .filter(
      (file) =>
        !readFileSync(path.join(process.cwd(), ...file.split("/")), "utf8").includes(esperado),
    );
  assert.deepEqual(desfasados, [], `la documentación debería decir «${esperado}»`);
});

test("las cifras de la documentación no se contradicen", () => {
  // DOCUMENTATION.md llegó a decir «331 pruebas (45 ficheros)» en el árbol y
  // «709 en 88» tres párrafos más abajo: nadie lo vio porque el número está a
  // mano en seis sitios. Aquí se exige que todas las menciones digan lo mismo,
  // y que los handlers citados sean los `route.ts` que hay en el disco.
  //
  // CONTRIBUTING y README se quedaron en «188 pruebas» durante meses: la
  // revisión de coherencia solo miraba los tres documentos técnicos.
  const ficheros = [
    "DOCUMENTATION.md",
    "src/lib/technical.ts",
    "src/lib/technical-en.ts",
    "CONTRIBUTING.md",
    "README.md",
  ];
  const fuentes = ficheros.map((file) => ({
    file,
    texto: readFileSync(path.join(process.cwd(), ...file.split("/")), "utf8"),
  }));

  const pruebas = new Set<string>();
  const archivos = new Set<string>();
  const patron =
    /(\d{3,4})\s+(?:unit and integration tests|unit- und Integrationstests|pruebas unitarias y de integración)\s*(?:in\s+|en\s+|\()?(\d{2,3})\s+(?:files|ficheros|Dateien)/g;
  for (const { texto } of fuentes) {
    for (const match of texto.matchAll(patron)) {
      pruebas.add(match[1]!);
      archivos.add(match[2]!);
    }
  }
  assert.equal(pruebas.size, 1, `la documentación da ${[...pruebas].join(" y ")} pruebas`);
  assert.equal(archivos.size, 1, `la documentación da ${[...archivos].join(" y ")} ficheros`);

  const handlers = routeFiles(API_DIR).length;
  for (const { file, texto } of fuentes) {
    const citados = new Set(
      [...texto.matchAll(/\b(\d{2,3}) (?:handlers|route files)\b/g)].map((match) => match[1]!),
    );
    if (citados.size === 0) continue;
    assert.deepEqual(
      [...citados],
      [String(handlers)],
      `${file} cita ${[...citados].join("/")} handlers/route files y en src/app/api hay ${handlers}`,
    );
  }
});

/** Todos los ficheros TypeScript de `src/`, para buscar lecturas del entorno. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Variables que pone la plataforma: no las configura quien despliega. */
const DEL_ENTORNO = new Set(["NODE_ENV", "NEXT_PHASE", "NEXT_RUNTIME"]);

test("toda variable de entorno que lee el código está en la plantilla", () => {
  // La lista de variables se quedaba atrás: el código leía ADMIN_EMAIL,
  // REQUIRE_EMAIL_VERIFICATION o WANDERBIBLIOTHEK_COVER_CACHE y `env.example`
  // no las mencionaba. Este test convierte «acordarse de documentarlas» en algo
  // que falla solo. Solo ve `process.env.X`; las que se leen por parámetro
  // (`pushConfig(env)`) hay que mirarlas a mano.
  const usadas = new Map<string, string>();
  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      const name = match[1]!;
      if (!usadas.has(name)) usadas.set(name, path.relative(process.cwd(), file));
    }
  }
  assert.ok(usadas.size > 10, "no se ha encontrado ninguna variable: revisa el patrón");

  const plantilla = readFileSync(path.join(process.cwd(), "deploy", "env.example"), "utf8");
  const declaradas = new Set(
    [...plantilla.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]!),
  );

  const faltan = [...usadas.entries()]
    .filter(([name]) => !DEL_ENTORNO.has(name) && !declaradas.has(name))
    .map(([name, file]) => `${name} (${file})`);
  assert.deepEqual(
    faltan,
    [],
    `Variables sin documentar en deploy/env.example: ${faltan.join(", ")}`,
  );
});

test("la edición del club no pierde el lugar ni el enlace del encuentro", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "app", "api", "clubs", "[clubId]", "route.ts"),
    "utf8",
  );
  assert.match(source, /meetsPlace: input\.meetsPlace/);
  assert.match(source, /meetsLink: input\.meetsLink/);
  assert.doesNotMatch(source, /bookId: input\.bookId \?\? null/);
});

test("la clave de Turnstile se lee en el servidor, no del bundle", () => {
  // La imagen se compila en la CI, sin la variable. Cuando el componente la
  // leía de `process.env.NEXT_PUBLIC_…`, el valor se horneaba vacío: la release
  // salió sin widget mientras el servidor seguía teniendo `TURNSTILE_SECRET`,
  // así que el registro rechazó todas las altas con «Completa la verificación
  // humana». Es pública, así que viaja como prop y depende del entorno.
  const leer = (...partes: string[]) =>
    readFileSync(path.join(process.cwd(), ...partes), "utf8");
  /** Sin comentarios: lo que importa es qué hace el código, no qué cuenta. */
  const codigo = (fuente: string) =>
    fuente
      .split("\n")
      .filter((linea) => {
        const limpia = linea.trim();
        return !limpia.startsWith("//") && !limpia.startsWith("*") && !limpia.startsWith("/*");
      })
      .join("\n");

  const dialogo = codigo(leer("src", "components", "dialogs", "auth-dialog.tsx"));
  assert.equal(
    dialogo.includes("NEXT_PUBLIC_TURNSTILE_SITE_KEY"),
    false,
    "el diálogo no puede leer la clave del entorno: llegaría vacía desde el bundle",
  );

  const shell = leer("src", "components", "wanderbibliothek-app.tsx");
  assert.match(shell, /turnstileSiteKey=\{turnstileSiteKey\}/, "el shell no pasa la clave al diálogo");

  const vista = leer("src", "app", "app-view.tsx");
  assert.match(
    vista,
    /process\.env\.NEXT_PUBLIC_TURNSTILE_SITE_KEY/,
    "la vista de servidor tiene que resolverla en cada petición",
  );

  const puente = codigo(leer("src", "components", "turnstile-bridge.tsx"));
  assert.equal(
    puente.includes("NEXT_PUBLIC_TURNSTILE_SITE_KEY"),
    false,
    "el puente de la app Android tampoco puede leerla del bundle",
  );
});

test("cada excepción del escáner tiene motivo y caducidad razonable", () => {
  // `--ignore-unfixed` deja pasar los avisos sin parche; la contrapartida es
  // esta lista: si una excepción no caduca, el aviso se queda aceptado para
  // siempre sin que nadie lo revise.
  const source = readFileSync(path.join(process.cwd(), ".trivyignore.yaml"), "utf8");
  const entries = source
    .split(/^\s*-\s+id:/m)
    .slice(1)
    .map((block) => block.split(/^\s*-\s+id:/m)[0]!);
  const ahora = Date.now();
  for (const entry of entries) {
    const id = entry.split("\n")[0]!.trim();
    const caducidad = /expired_at:\s*(\d{4}-\d{2}-\d{2})/.exec(entry)?.[1];
    const motivo = /statement:\s*(.+)/.exec(entry)?.[1]?.trim() ?? "";
    assert.ok(caducidad, `${id}: falta expired_at`);
    assert.ok(motivo.length >= 20, `${id}: el motivo es demasiado corto`);
    const limite = Date.parse(`${caducidad}T00:00:00Z`);
    assert.ok(limite > ahora, `${id}: la excepción caducó el ${caducidad}`);
    assert.ok(
      limite - ahora <= 90 * 24 * 60 * 60 * 1000,
      `${id}: caduca a más de 90 días, demasiado tiempo sin revisar`,
    );
  }
  assert.match(source, /vulnerabilities:\s*(\[\]|\n)/, "el fichero debe declarar la lista");
});
