import assert from "node:assert/strict";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { login, waitForHydration } from "./helpers";

/**
 * Auditoría de accesibilidad automatizada.
 *
 * axe no sustituye a una revisión con lector de pantalla, pero sí encuentra lo
 * que se rompe sin que nadie lo note: un contraste que no llega a 4.5:1, un
 * botón sin nombre, un encabezado que salta de h1 a h3, un campo sin etiqueta.
 * Se ejecuta en las páginas que ve todo el mundo y en la ventana de acceso.
 *
 * Solo se exige lo que la norma marca como barrera (impacto `serious` y
 * `critical`): un aviso `minor` de axe no justifica bloquear una rama.
 */
const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Con `prefers-reduced-motion` puesto, las entradas no se animan.
 *
 * No es un atajo para que la prueba pase: axe mide colores **compuestos**, y a
 * mitad de una animación de opacidad calcula contrastes de 4,33 donde en reposo
 * hay 5,5. Esperar a que terminen las animaciones dejaba la comprobación a
 * merced de cuándo arrancaba la del contenido nuevo, y eso ya falló una vez.
 * Con menos movimiento —que la propia web respeta en doce sitios— lo que se
 * audita es el estado final, y además se audita esa variante, que es la que ve
 * quien tiene problemas vestibulares.
 */
test.use({ reducedMotion: "reduce" });

async function revisar(page: Page, contexto: string): Promise<void> {
  const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  const barreras = resultado.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  const resumen = barreras
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(" "))
          .join("\n  ")}`,
    )
    .join("\n");
  expect(barreras, `barreras de accesibilidad en ${contexto}:\n${resumen}`).toEqual([]);
}

test("la portada no tiene barreras de accesibilidad", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await expect(page.locator(".book-card:visible").first()).toBeVisible();
  await revisar(page, "la portada");
});

test("el catálogo con sesión no tiene barreras de accesibilidad", async ({ page }) => {
  await login(page, "ana@wanderbibliothek.test");
  await page.goto("/?view=discover");
  await waitForHydration(page);
  await expect(page.locator(".book-card:visible").first()).toBeVisible();
  await revisar(page, "el catálogo");
});

test("la ficha de un ejemplar no tiene barreras de accesibilidad", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await page.locator(".book-card:visible a").first().click();
  await expect(page).toHaveURL(/\/werk\//);
  await waitForHydration(page);
  await revisar(page, "la ficha de un ejemplar");
});

test("la ventana de acceso no tiene barreras de accesibilidad", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Solo el diálogo: el fondo sigue en el árbol, pero está inerte.
  const resultado = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(ETIQUETAS).analyze();
  const barreras = resultado.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(
    barreras.map((violation) => `${violation.id}: ${violation.help}`),
    "barreras en la ventana de acceso",
  ).toEqual([]);
});

/** Escapa un texto para usarlo dentro de una expresión regular. */
function escape(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("el monograma y la cifra de avisos van en el nombre accesible", async ({ page }) => {
  await login(page, "ana@wanderbibliothek.test");
  // Los dos controles del topbar muestran texto que no es su etiqueta: las
  // iniciales de la persona y una cifra. Quien navega con dictado dice lo que
  // ve, así que el nombre accesible tiene que contenerlo (WCAG 2.5.3).
  const avatar = page.getByRole("button", { name: /Abrir menú de cuenta/ });
  const iniciales = (await page.locator(".top-avatar .avatar").innerText()).trim();
  assert.ok(iniciales.length > 0, "el avatar tiene que mostrar las iniciales");
  // `toHaveAccessibleName` con texto exige la cadena completa; se compara con
  // una expresión para no atar la prueba al orden de la etiqueta.
  await expect(avatar).toHaveAccessibleName(new RegExp(escape(iniciales)));

  const avisos = page.locator(".notification-button");
  if ((await avisos.count()) > 0) {
    const visible = (await avisos.innerText()).trim();
    if (visible) await expect(avisos).toHaveAccessibleName(new RegExp(escape(visible)));
  }
});
