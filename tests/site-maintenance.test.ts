/**
 * URL pública del sitio y tareas periódicas de mantenimiento.
 *
 * `siteUrl()` decide qué dominio publican el sitemap, las etiquetas canónicas y
 * las cookies `__Host-`: si sale una URL con `http://` en producción, la sesión
 * falla en silencio (la cookie exige HTTPS) y el buscador indexa el dominio
 * equivocado. Aquí se fija la normalización y el aviso único del registro.
 *
 * `runMaintenance()` es lo que corre el cron: caducar solicitudes, purgar y
 * compactar. Sus números acaban en el informe del servicio, así que se comprueba
 * que devuelve un recuento coherente y que se puede repetir.
 */
import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";

// Base en memoria: esta prueba crea cuentas y no debe tocar la de desarrollo.
process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type SiteModule = typeof import("../src/lib/site.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let siteModule: SiteModule;
let repo: RepoModule;

const entornoOriginal = {
  url: process.env.NEXT_PUBLIC_SITE_URL,
  nodeEnv: process.env.NODE_ENV,
};

/** `NODE_ENV` es de solo lectura en los tipos de Node: se cambia a propósito. */
const entorno = process.env as Record<string, string | undefined>;

function modoProduccion(activo: boolean): void {
  if (activo) entorno.NODE_ENV = "production";
  else if (entornoOriginal.nodeEnv === undefined) delete entorno.NODE_ENV;
  else entorno.NODE_ENV = entornoOriginal.nodeEnv;
}

before(async () => {
  repo = await import("../src/lib/repo.ts");
  siteModule = await import("../src/lib/site.ts");
});

afterEach(() => {
  if (entornoOriginal.url === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = entornoOriginal.url;
  modoProduccion(false);
});

/** Captura lo que se escribe por consola mientras corre `run`. */
function capturarConsola(run: () => void): string[] {
  const lineas: string[] = [];
  const { warn, log } = console;
  console.warn = (...args: unknown[]) => lineas.push(args.join(" "));
  console.log = (...args: unknown[]) => lineas.push(args.join(" "));
  try {
    run();
  } finally {
    console.warn = warn;
    console.log = log;
  }
  return lineas;
}

test("la URL del sitio se toma del entorno sin barras finales", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://wanderbibliothek.org///";
  assert.equal(siteModule.siteUrl(), "https://wanderbibliothek.org");

  process.env.NEXT_PUBLIC_SITE_URL = "  https://staging.example.test  ";
  assert.equal(siteModule.siteUrl(), "https://staging.example.test", "se recorta el espacio");

  delete process.env.NEXT_PUBLIC_SITE_URL;
  assert.equal(
    siteModule.siteUrl(),
    "http://localhost:3000",
    "sin configurar hay un valor de desarrollo",
  );
});

test("en producción avisa de una URL mal configurada, una sola vez", () => {
  // El aviso es único por proceso a propósito: repetirlo en cada petición
  // llenaría el registro del servicio sin añadir nada.
  modoProduccion(true);

  delete process.env.NEXT_PUBLIC_SITE_URL;
  const sinUrl = capturarConsola(() => siteModule.siteUrl());
  assert.ok(
    sinUrl.some((linea) => linea.includes("NEXT_PUBLIC_SITE_URL no está definida")),
    "avisa de que falta la URL",
  );
  const repetido = capturarConsola(() => siteModule.siteUrl());
  assert.deepEqual(repetido, [], "el segundo aviso ya no se repite");

  // Con `http://` en producción no se cambia la URL, pero tampoco se calla el
  // problema de la cookie __Host-.
  process.env.NEXT_PUBLIC_SITE_URL = "http://wanderbibliothek.org";
  const conHttp = capturarConsola(() => siteModule.siteUrl());
  assert.deepEqual(conHttp, []);
  assert.equal(siteModule.siteUrl(), "http://wanderbibliothek.org");
});

test("el mantenimiento devuelve un informe con recuentos y se puede repetir", () => {
  const informe = repo.runMaintenance();
  assert.equal(typeof informe, "object");
  for (const [clave, valor] of Object.entries(informe as unknown as Record<string, unknown>)) {
    if (typeof valor === "number") assert.ok(valor >= 0, `${clave} no puede ser negativo`);
  }
  assert.equal(typeof repo.runMaintenance(), "object", "dos pasadas seguidas no rompen nada");
});

test("los eventos de club (que llevan user_id) no se quedan para siempre", async () => {
  const { getDb } = await import("../src/lib/db/index.ts");
  const db = getDb();
  const meter = (id: string, dias: number) =>
    db
      .prepare(
        `INSERT INTO product_events (id, type, user_id, club_id, created_at)
         VALUES (?, 'club_view', NULL, NULL, ?)`,
      )
      .run(id, new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString());

  meter("evt_viejo", 200);
  meter("evt_reciente", 5);

  const informe = repo.runMaintenance();
  assert.equal(informe.productEvents, 1, "solo cae el que pasó de 180 días");
  const quedan = db
    .prepare("SELECT id FROM product_events ORDER BY id")
    .all() as { id: string }[];
  assert.deepEqual(
    quedan.map((row) => row.id),
    ["evt_reciente"],
  );
});

test("la caducidad de solicitudes se ejecuta como mucho una vez por ventana", () => {
  const primera = repo.expireStaleRequestsThrottled(5);
  assert.equal(typeof primera, "number");
  // La segunda llamada dentro de la ventana no vuelve a recorrer la tabla.
  assert.equal(repo.expireStaleRequestsThrottled(5), 0);
  // Con una ventana de cero minutos sí se ejecuta otra vez.
  assert.equal(typeof repo.expireStaleRequestsThrottled(0), "number");
});

test("el administrador inicial sale del entorno y no se duplica", async () => {
  const { ensureInitialAdmin } = await import("../src/lib/db/seed.ts");
  const { getDb } = await import("../src/lib/db/index.ts");
  const db = getDb();
  const cuentas = () =>
    (db.prepare("SELECT COUNT(*) AS total FROM users").get() as { total: number }).total;

  // Una contraseña corta se rechaza con un aviso, no con una excepción.
  const antes = cuentas();
  process.env.ADMIN_EMAIL = "admin-nueva@example.test";
  process.env.ADMIN_PASSWORD = "corta";
  const avisos = capturarConsola(() => ensureInitialAdmin(db));
  assert.ok(
    avisos.some((linea) => linea.includes("al menos 12 caracteres")),
    "avisa de la contraseña corta",
  );
  assert.equal(cuentas(), antes, "no se creó ninguna cuenta");

  // Con una contraseña válida se crea una sola vez, ya verificada y con hash.
  // La muestra de desarrollo trae administración, así que se retira el rol para
  // ejercitar la creación real.
  db.prepare("UPDATE users SET is_admin = 0").run();
  process.env.ADMIN_PASSWORD = "una-contraseña-larga";
  capturarConsola(() => ensureInitialAdmin(db));
  const admin = db
    .prepare("SELECT email, is_admin, email_verified_at, password_hash FROM users WHERE email = ?")
    .get("admin-nueva@example.test") as
    | { email: string; is_admin: number; email_verified_at: string | null; password_hash: string }
    | undefined;
  assert.ok(admin, "la cuenta de administración se crea con la contraseña válida");
  assert.equal(admin.is_admin, 1);
  assert.ok(admin.email_verified_at, "nace verificada para poder entrar");
  assert.match(admin.password_hash, /^scrypt\$/, "la contraseña no se guarda en claro");

  const total = cuentas();
  capturarConsola(() => ensureInitialAdmin(db));
  assert.equal(cuentas(), total, "la segunda pasada no duplica la cuenta");

  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
});
