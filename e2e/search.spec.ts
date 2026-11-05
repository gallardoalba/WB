import { expect, test } from "@playwright/test";
import { login as loginAs } from "./helpers";

async function login(page: Parameters<typeof loginAs>[0]) {
  await loginAs(page, "clara@wanderbibliothek.test");
}

/**
 * Buscador global de la cabecera.
 *
 * Antes no había ninguna entrada común: se buscaba dentro de cada sección por
 * separado. El campo de arriba es un formulario GET normal, así que funciona
 * sin JavaScript y deja la búsqueda en la URL.
 */
test("el buscador de la cabecera lleva a los resultados", async ({ page }) => {
  await login(page);
  await page.goto("/clubes");

  await page.locator("#site-search-q").fill("biblioteca");
  await page.locator("#site-search-q").press("Enter");

  await expect(page).toHaveURL(/\/buscar\?q=biblioteca/);
  await expect(page.getByRole("heading", { name: /Resultados para/ })).toBeVisible();
  // El club sembrado se llama «Los martes de la biblioteca».
  await expect(page.locator(".search-group", { hasText: "Clubes" })).toContainText(
    "Los martes de la biblioteca",
  );
});

test("la búsqueda se puede compartir por enlace y avisa cuando no hay nada", async ({ page }) => {
  await login(page);

  // Otra lectora (el directorio nunca incluye a quien busca).
  await page.goto("/buscar?q=lucia");
  await expect(page.locator(".search-group", { hasText: "Lectores" })).toContainText("Lucía");

  await page.goto("/buscar?q=zzzzzz");
  await expect(page.getByText("Nada con «zzzzzz»")).toBeVisible();
});
