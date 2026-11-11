import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Con `PLAYWRIGHT_BASE_URL` las pruebas usan un servidor ya arrancado (por
// ejemplo el `next dev` de :3000 que estés usando) en vez de levantar otro:
// Next no permite dos instancias de desarrollo en el mismo directorio.
const EXTERNAL_SERVER = process.env.PLAYWRIGHT_BASE_URL;
const BASE_URL = EXTERNAL_SERVER ?? `http://localhost:${PORT}`;
const BASE_HOST = new URL(BASE_URL).hostname;

export default defineConfig({
  testDir: "./e2e",
  // Vacía la tabla de cuotas antes de cada pasada: la suite hace muchos accesos
  // con las cuentas de demostración y dos ejecuciones seguidas agotaban el
  // límite (20 por cuenta cada 15 min) y fallaban con un 429 ajeno a la prueba.
  globalSetup: "./e2e/global-setup.ts",
  // En CI el servidor es `next dev` sobre una máquina recién creada: la primera
  // visita a una ruta la compila, y con 30 s una ficha en frío se comía el
  // margen de la prueba (fallaba por lentitud, no por el código).
  timeout: process.env.CI ? 45_000 : 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Una sola instancia en CI: cada contexto de navegador tiene su propia clave
  // E2E y la publica en la ranura `web` de la cuenta. Con dos workers, otra
  // prueba que entre con la misma cuenta publica la suya entre medias, el
  // diálogo pasa a «este navegador tiene otra clave» y el envío queda
  // deshabilitado (`e2e/direct.spec.ts` agotaba los 120 s).
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // Next dev bloquea HMR para orígenes distintos de su host de arranque.
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // La plataforma llega en alemán a quien no ha elegido idioma. Las pruebas
    // están escritas en castellano, así que fijan la cookie del selector; la
    // prueba del idioma por defecto navega sin ella.
    storageState: {
      cookies: [
        {
          name: "wanderbibliothek-locale",
          value: "es",
          domain: BASE_HOST,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: EXTERNAL_SERVER
    ? undefined
    : {
        command: `npm run dev -- -p ${PORT}`,
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          SEED_DEMO: "1",
          NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
        },
      },
});
