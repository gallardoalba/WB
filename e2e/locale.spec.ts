import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

// El resto de la suite fija la cookie del selector en castellano; estas pruebas
// navegan como quien llega por primera vez, sin ninguna preferencia guardada.
test.use({ storageState: { cookies: [], origins: [] } });

// Sin cookie manda el navegador: cada bloque se declara el suyo.
test.describe("idioma por defecto: el del navegador", () => {
  test.use({ locale: "de-DE" });

  test("un navegador en alemán recibe la interfaz en alemán", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator(".hero-tagline")).toHaveText(
      "Bücher, die reisen. Menschen, die sich begegnen.",
    );

    await page.goto("/documentacion");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Technische Dokumentation",
    );
  });

  test("el selector cambia a castellano y lo recuerda al recargar", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await page.locator(".locale-select").selectOption("es");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");

    await page.reload();
    await expect(page.locator(".hero-tagline")).toHaveText(
      "Libros que viajan. Personas que se encuentran.",
    );
  });

  test("el selector cambia a inglés y lo recuerda al recargar", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await page.locator(".locale-select").selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.reload();
    await expect(page.locator(".hero-tagline")).toHaveText(
      "Books that travel. People who meet.",
    );
  });
});

test.describe("idioma por defecto: navegador en inglés y enlaces del correo", () => {
  test.use({ locale: "en-US" });

  test("un navegador en inglés recibe la interfaz en inglés", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator(".hero-tagline")).toHaveText(
      "Books that travel. People who meet.",
    );
  });

  test("un enlace con ?lang=es abre en castellano y lo deja guardado", async ({ page }) => {
    // Es lo que llevan los correos: la página del token se abre en el idioma en
    // el que se escribió el aviso, no en el del navegador.
    await page.goto("/?lang=es");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");

    // Y queda como preferencia: la navegación siguiente sigue en castellano.
    await page.goto("/listas");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
  });
});
