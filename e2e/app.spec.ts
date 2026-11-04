import { expect, test, type Page } from "@playwright/test";

/** Espera a que el layout cliente haya hidratado y aplicado el tema. */
async function waitForHydration(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
}

test("el catálogo carga y permite buscar", async ({ page }) => {
  await page.goto("/?view=discover");
  await expect(page).toHaveTitle(/Wanderbibliothek/);
  await expect(page.locator(".book-card").first()).toBeVisible();

  await waitForHydration(page);
  await page.locator("#catalog-search").fill("junco");
  await expect(page.locator(".book-card")).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(".book-card")).toContainText("El infinito en un junco");
});

test("el tema claro/oscuro se conmuta y persiste", async ({ page }) => {  await page.goto("/");
  await waitForHydration(page);

  const toggle = page.locator(".theme-toggle");
  await toggle.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("b2p-theme"))).toBe("dark");

  await toggle.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("una cuenta demo puede iniciar sesión", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.locator('input[name="email"]').fill("ana@book2peer.test");
  await dialog.locator('input[name="password"]').fill("demo1234");
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();

  await expect(page.getByRole("button", { name: "Abrir menú de cuenta" })).toBeVisible();
  await expect(page.getByText("Ana Martínez").first()).toBeVisible();
});

test("un diálogo deja el fondo inerte y lo libera al cerrar", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // El diálogo se monta en <body> y el shell queda fuera del alcance.
  expect(await dialog.evaluate((element) => element.closest("main.app-shell") === null)).toBe(true);
  await expect(page.locator("main.app-shell")).toHaveAttribute("inert", "");

  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("main.app-shell")).not.toHaveAttribute("inert", "");
});

test("el perfil explica el estado del cifrado de mensajes", async ({ page }) => {  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const auth = page.getByRole("dialog");
  await auth.locator('input[name="email"]').fill("ana@book2peer.test");
  await auth.locator('input[name="password"]').fill("demo1234");
  await auth.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Abrir menú de cuenta" })).toBeVisible();

  // El menú y el resumen del diálogo viven en capas fijas: se pulsan por DOM.
  await page
    .getByRole("button", { name: "Abrir menú de cuenta" })
    .evaluate((element) => (element as HTMLElement).click());
  await page
    .getByRole("menuitem", { name: "Cuenta y ciudad" })
    .evaluate((element) => (element as HTMLElement).click());

  const profile = page.getByRole("dialog");
  const encryption = profile.locator("details").filter({ hasText: "Cifrado de mensajes" }).first();
  await expect(encryption).toBeVisible();
  await encryption.locator("summary").evaluate((element) => (element as HTMLElement).click());
  await expect(
    encryption.getByText("Los mensajes de tus intercambios se cifran en este navegador"),
  ).toBeVisible();
  // Un solo control según el estado: activo (huella), publicar o pedir contraseña.
  await expect(encryption.locator("button, input[type='password']").first()).toBeVisible();
});

test("guardar un libro no roba el foco del teclado", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="email"]').fill("ana@book2peer.test");
  await dialog.locator('input[name="password"]').fill("demo1234");
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Abrir menú de cuenta" })).toBeVisible();

  await page.goto("/?view=discover");
  const favorite = page.locator(".favorite-button").first();
  await expect(favorite).toBeVisible();
  const pressed = await favorite.getAttribute("aria-pressed");

  await favorite.evaluate((element) => (element as HTMLElement).focus());
  await favorite.evaluate((element) => (element as HTMLElement).click());

  // El refresco ya no desmonta la cuadrícula: el foco sigue en el corazón.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.className ?? ""))
    .toContain("favorite-button");
  await expect.poll(async () => favorite.getAttribute("aria-pressed")).not.toBe(pressed);

  // Espera a que el guardado termine (el botón deja de estar ocupado) y
  // devuelve la estantería de la cuenta demo a su estado inicial.
  await expect.poll(async () => favorite.getAttribute("aria-disabled")).toBeNull();
  await favorite.evaluate((element) => (element as HTMLElement).click());
  await expect.poll(async () => favorite.getAttribute("aria-pressed")).toBe(pressed);
});

test("el panel de comunidad carga cada pestaña por separado", async ({ page }) => {  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="email"]').fill("ana@book2peer.test");
  await dialog.locator('input[name="password"]').fill("demo1234");
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Abrir menú de cuenta" })).toBeVisible();

  await page.goto("/?view=community&tab=readers");
  await expect(page.locator(".reader-card").first()).toBeVisible();
  // El snapshot ya solo trae la pestaña pedida: ni clubes ni listas.
  await expect(page.locator(".club-card")).toHaveCount(0);

  await page.goto("/?view=community&tab=clubs");
  await expect(page.locator(".reader-card")).toHaveCount(0);
});

test("un libro se puede previsualizar sin sesión y el acceso vuelve a él", async ({ page }) => {  // Calienta la ruta de ficha antes de medir el retorno del login: en un
  // servidor recién construido la primera compilación puede superar 15 s.
  await page.goto("/libro/lst_1");
  await page.goto("/");
  await waitForHydration(page);
  await page.locator(".book-card .request-button").first().evaluate((element) =>
    (element as HTMLElement).click(),
  );
  const preview = page.getByRole("dialog");
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Entrar para pedirlo" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="email"]').fill("ana@book2peer.test");
  await dialog.locator('input[name="password"]').fill("demo1234");
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();

  await expect(page).toHaveURL(/\/libro\/lst_/, { timeout: 15_000 });
});

test("las páginas internas piden sesión y el panel marca lo privado", async ({ page }) => {
  await page.goto("/lectores");
  await expect(page).toHaveURL(/\/\?auth=1&next=/);
  await expect(page.locator(".sidebar .nav-item.locked")).toHaveCount(3);
  await expect(page.locator('.sidebar a[href="/clubes"]')).toHaveCount(0);

  await page.locator(".sidebar .nav-item.locked").first().evaluate((element) =>
    (element as HTMLElement).click(),
  );
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("salud, Open Graph y sitemap mínimo", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBeTruthy();

  const og = await request.get("/opengraph-image");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toContain("image/png");

  const sitemap = await request.get("/sitemap.xml");
  const body = await sitemap.text();
  expect(body).toContain("<loc>");
  expect(body).not.toContain("/clubes/");
  expect(body).not.toContain("/listas/");
});
