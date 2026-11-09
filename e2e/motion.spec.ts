import { expect, test, type Page } from "@playwright/test";
import { login, waitForHydration } from "./helpers";

/**
 * Movimiento.
 *
 * Las tarjetas y las fichas entran con una animación de opacidad y
 * desplazamiento, el tema cambia con un fundido cruzado y quien pide menos
 * movimiento no ve nada de eso. Se comprueba en un navegador de verdad porque
 * el CSS no basta: lo que importa es que las reglas ganen a las del resto de la
 * hoja y que `prefers-reduced-motion` las apague.
 */

/**
 * Cuenta las llamadas a `document.startViewTransition` en la página.
 *
 * Hay que instalarlo antes de que arranque la aplicación y esperar después a la
 * hidratación: en `next dev` la página negocia el idioma y puede recargarse, y
 * un contador leído en el documento anterior se queda en cero.
 */
async function contarTransiciones(page: Page) {
  await page.addInitScript(() => {
    window.__viewTransitions = 0;
    const original = document.startViewTransition?.bind(document);
    if (!original) return;
    document.startViewTransition = ((callback: () => void) => {
      window.__viewTransitions = (window.__viewTransitions ?? 0) + 1;
      return original(callback);
    }) as typeof document.startViewTransition;
  });
}

test("las tarjetas del catálogo entran escalonadas", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await waitForHydration(page);
  const tarjetas = page.locator(".book-card:visible");
  await expect(tarjetas.first()).toBeVisible();

  const primera = await tarjetas.nth(0).evaluate((el) => getComputedStyle(el).animationName);
  const segunda = await tarjetas.nth(1).evaluate((el) => getComputedStyle(el).animationName);
  expect(primera).toBe("card-in");
  expect(segunda).toBe("card-in");

  // La segunda espera lo suyo: sin el retardo, el escalonado no existe.
  const retardo = await tarjetas
    .nth(1)
    .evaluate((el) => getComputedStyle(el).animationDelay);
  expect(retardo).toBe("0.045s");
});

test("la ficha entra con su propia animación", async ({ page }) => {
  await login(page, "ana@wanderbibliothek.test");
  const href = await page
    .locator(".book-card:visible")
    .first()
    .locator('a[href*="/libro/"]')
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(href!);
  const detalle = page.locator(".book-detail");
  await expect(detalle).toBeVisible();
  const animacion = await detalle.evaluate((el) => getComputedStyle(el).animationName);
  expect(animacion).toBe("page-in");
});

test("con movimiento reducido no queda ninguna animación", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await waitForHydration(page);
  const tarjeta = page.locator(".book-card:visible").first();
  await expect(tarjeta).toBeVisible();

  expect(await tarjeta.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

/**
 * El cambio de tema se hace con `document.startViewTransition`, que es la
 * forma de tener un fundido cruzado sin librería. Se comprueba que se llama (y
 * una sola vez): si alguien quita el envoltorio, el tema seguiría cambiando,
 * pero con un parpadeo duro que es justo lo que se quería evitar.
 */
test("el cambio de tema usa view transition cuando el navegador puede", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await contarTransiciones(page);
  await page.goto("/");
  await waitForHydration(page);

  const boton = page.locator(".theme-toggle");
  await expect(boton).toBeVisible();

  const antes = await page.evaluate(() => document.documentElement.dataset.theme);
  await boton.click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .not.toBe(antes);

  expect(await page.evaluate(() => window.__viewTransitions)).toBe(1);
});

test("con movimiento reducido el tema cambia sin transición", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await contarTransiciones(page);
  await page.goto("/");
  await waitForHydration(page);

  await page.locator(".theme-toggle").click();
  expect(await page.evaluate(() => window.__viewTransitions)).toBe(0);
});

declare global {
  interface Window {
    /** Contador de `startViewTransition` para las pruebas de tema. */
    __viewTransitions?: number;
  }
}
