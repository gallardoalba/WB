import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

// El resto de la suite fija la cookie del selector en castellano; estas pruebas
// navegan como quien llega por primera vez, sin ninguna preferencia guardada.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("idioma por defecto", () => {
  test("sin cookie la interfaz llega en alemán", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(
      "Bücher, die weiterreisen",
    );

    await page.goto("/documentacion");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Technische Dokumentation");
  });

  test("el selector cambia a castellano y lo recuerda al recargar", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await page.locator(".locale-select").selectOption("es");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(
      "Los libros siguen viajando.",
    );
  });
});
