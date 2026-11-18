import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

/**
 * Presupuesto de bytes.
 *
 * Las portadas llegaron a pedirse sin optimizar: una tarjeta de 220 px bajaba
 * un JPEG de 1.3 MB, y una visita al catálogo eran más de 5 MB. Se arregló, y
 * nada impedía volver atrás —basta con quitar el `?v=` de la URL o volver a
 * marcar la imagen como `unoptimized`— porque las pruebas solo miraban que la
 * página se viera.
 *
 * Esto es una valla, no una medición: los topes están muy por encima de lo que
 * cuesta hoy para que no salten por una imagen más o por un componente nuevo.
 * Lo que no puede pasar es volver a lo de antes.
 */
const MAX_TOTAL_VISITA = 1_750 * 1024;
const MAX_IMAGEN = 250 * 1024;

/** Lo que el navegador ha descargado de verdad, incluido el documento. */
async function transferido(page: Page) {
  return page.evaluate(() => {
    const recursos = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const navegacion = performance.getEntriesByType("navigation")[0] as
      | PerformanceResourceTiming
      | undefined;
    const imagenes = recursos
      .filter((recurso) => recurso.initiatorType === "img" || /\.(jpe?g|png|webp|avif)(\?|$)/.test(recurso.name))
      .map((recurso) => ({ url: recurso.name, bytes: recurso.transferSize ?? 0 }))
      .sort((a, b) => b.bytes - a.bytes);
    return {
      total: recursos.reduce((suma, recurso) => suma + (recurso.transferSize ?? 0), 0) + (navegacion?.transferSize ?? 0),
      imagenes,
    };
  });
}

test("una visita al catálogo cabe en el presupuesto de bytes", async ({ page }) => {
  // En `next dev` el bundle de JavaScript no está optimizado y el total no dice
  // nada del despliegue; el presupuesto se mide contra el build de producción.
  test.skip(!process.env.CI, "el presupuesto se mide sobre el build de producción (CI)");

  await page.goto("/?view=discover");
  await waitForHydration(page);
  await expect(page.locator(".book-card:visible").first()).toBeVisible();

  // Las portadas van con carga diferida: sin recorrer la página, media docena
  // ni siquiera se han pedido y el total saldría bueno por no haber mirado.
  await page.evaluate(async () => {
    const alto = document.body.scrollHeight;
    for (let y = 0; y <= alto; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");

  const { total, imagenes } = await transferido(page);
  const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

  // Una línea en el registro de CI: cuando el presupuesto empiece a apretar se
  // ve la tendencia sin abrir la traza.
  console.log(
    `[rendimiento] catálogo: ${kb(total)} en total, la imagen mayor ${kb(imagenes[0]?.bytes ?? 0)}`,
  );

  expect(total, `la visita descargó ${kb(total)}`).toBeLessThan(MAX_TOTAL_VISITA);

  const desproporcionada = imagenes.find((imagen) => imagen.bytes > MAX_IMAGEN);
  expect(
    desproporcionada ? `${kb(desproporcionada.bytes)} en ${desproporcionada.url}` : "",
    "ninguna imagen puede pasar de 250 KB",
  ).toBe("");
});
