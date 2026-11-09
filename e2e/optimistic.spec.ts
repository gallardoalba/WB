import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Estado optimista (`useOptimistic`).
 *
 * Lo que se comprueba aquí no es que el botón funcione, sino que **cambia antes
 * de que el servidor conteste**: la petición se retiene con `page.route` y, con
 * la respuesta todavía en el aire, el `aria-pressed` ya refleja la pulsación. Si
 * alguien vuelve a poner un `await api(...)` antes de pintar, esta prueba falla.
 *
 * Funciona con cuentas y obras sembradas por `SEED_DEMO`; la obra sale del
 * sitemap para no depender de un identificador escrito a mano.
 */

async function primeraObra(page: Page) {
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  const bok = [...sitemap.matchAll(/\/werk\/(bok_[A-Za-z0-9-]+)/g)][0]?.[1];
  expect(bok, "el sitemap debería traer al menos una obra").toBeTruthy();
  return bok!;
}

/** Retiene la respuesta de `patron` hasta que se llama a `liberar`. */
async function retener(page: Page, patron: string) {
  let liberar: () => void = () => {};
  const turno = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  await page.route(patron, async (route) => {
    await turno;
    await route.continue();
  });
  return () => liberar();
}

test("el aviso de nuevos ejemplares responde antes de que conteste el servidor", async ({
  page,
}) => {
  await login(page, "ana@wanderbibliothek.test");
  const bok = await primeraObra(page);
  const liberar = await retener(page, "**/api/books/*/want");

  await page.goto(`/obra/${bok}`);
  const boton = page.locator(".book-want button").first();
  await expect(boton).toBeVisible();

  const antes = await boton.getAttribute("aria-pressed");
  await boton.click();
  await expect(boton).toHaveAttribute(
    "aria-pressed",
    antes === "true" ? "false" : "true",
    { timeout: 1500 },
  );
  liberar();
});

test("el estado de lectura cambia antes de que conteste el servidor", async ({ page }) => {
  await login(page, "ana@wanderbibliothek.test");
  const bok = await primeraObra(page);
  const liberar = await retener(page, "**/api/books/*/reading-state");

  await page.goto(`/obra/${bok}`);
  const leyendo = page.locator(".reading-state button", { hasText: "Leyendo" }).first();
  await expect(leyendo).toBeVisible();

  const antes = await leyendo.getAttribute("aria-pressed");
  await leyendo.click();
  await expect(leyendo).toHaveAttribute(
    "aria-pressed",
    antes === "true" ? "false" : "true",
    { timeout: 1500 },
  );
  liberar();
});
