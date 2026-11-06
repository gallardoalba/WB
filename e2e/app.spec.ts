import { expect, test, type Page } from "@playwright/test";
import { login, waitForHydration } from "./helpers";

/** Entra con la cuenta de demostración y deja la portada cargada. */
async function loginAsDemo(page: Page) {
  await login(page, "ana@wanderbibliothek.test");
}

test("el menú de cuenta se opera con el teclado", async ({ page }) => {
  await loginAsDemo(page);
  const trigger = page.getByRole("button", { name: "Abrir menú de cuenta" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");

  await expect(page.getByRole("menuitem", { name: "Mi perfil" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Cuenta", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("menuitem", { name: "Mi perfil" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("el catálogo carga y permite buscar", async ({ page }) => {
  // El catálogo exige sesión: muestra nombre y ciudad de cada lector.
  await loginAsDemo(page);
  await page.goto("/?view=discover");
  await expect(page).toHaveTitle(/Wanderbibliothek/);
  await expect(page.locator(".book-card:visible").first()).toBeVisible();

  await waitForHydration(page);
  // La muestra de demostración tiene un solo Bakunin a la venta: el otro ya
  // encontró lector.
  await page.locator("#catalog-search:visible").fill("Bakunin");
  await expect(page.locator(".book-card:visible")).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(".book-card:visible")).toContainText(
    "Staatlichkeit und Anarchie",
  );
});

test("sin sesión el catálogo no se expone", async ({ page }) => {
  await page.goto("/descubrir");
  await expect(page).toHaveURL(/\/\?auth=1&next=/);
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

  await dialog.locator('input[name="email"]').fill("ana@wanderbibliothek.test");
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

test("la cuenta es una página con el estado del cifrado", async ({ page }) => {
  await loginAsDemo(page);

  // El menú y el resumen viven en capas fijas: se pulsa por DOM.
  await page
    .getByRole("button", { name: "Abrir menú de cuenta" })
    .evaluate((element) => (element as HTMLElement).click());
  await page
    .getByRole("menuitem", { name: "Cuenta", exact: true })
    .evaluate((element) => (element as HTMLElement).click());

  // Ya no hay diálogo: es la ruta /cuenta con su propio contenido.
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const encryption = page.locator("details").filter({ hasText: "Cifrado de mensajes" }).first();
  await expect(encryption).toBeVisible();
  await encryption.locator("summary").evaluate((element) => (element as HTMLElement).click());
  // La sección enseña el estado con una insignia y un titular, no un párrafo
  // suelto: o está activo en este navegador, o hay que publicar la clave.
  await expect(encryption.locator(".crypto-badge")).toHaveText(/Activo|Sin activar/);
  await expect(encryption.locator(".crypto-status strong")).toBeVisible();
  // Y dice explícitamente hasta dónde llega la privacidad.
  await expect(
    encryption.getByText(/Ni quien administra la web puede leer el contenido/),
  ).toBeVisible();
  // Un solo estado según la clave del navegador: activo (con la huella), publicar
  // o pedir contraseña. El orden depende de lo que tarde la petición, así que se
  // aceptan los tres en vez de exigir un botón que puede no existir.
  await expect(
    encryption.locator("button, input[type='password'], code.secret-code").first(),
  ).toBeVisible();
});

test("guardar un libro no roba el foco del teclado", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="email"]').fill("ana@wanderbibliothek.test");
  await dialog.locator('input[name="password"]').fill("demo1234");
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Abrir menú de cuenta" })).toBeVisible();

  await page.goto("/?view=discover");
  const favorite = page.locator(".favorite-button:visible").first();
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

test("el panel de administración abre con sus secciones", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="email"]').fill("admin@wanderbibliothek.test");
  await dialog.locator('input[name="password"]').fill("demo1234");
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Abrir menú de cuenta" })).toBeVisible();

  await page.goto("/admin");

  // La administración ya tiene entrada propia en la barra lateral: /admin no
  // se confunde con la página de cuenta.
  await expect(
    page.getByRole("navigation", { name: "Administración" }).getByRole("link", {
      name: "Moderación",
    }),
  ).toHaveAttribute("href", "/admin");

  // En producción el panel exige segundo factor. Sin TOTP ya no responde «Esta
  // página no existe»: explica el requisito y ofrece el camino para activarlo.
  const aviso = page.getByRole("heading", {
    name: "Falta un paso: verificación en dos pasos",
  });
  // `exact` porque el estado vacío («Sin denuncias abiertas») también es un
  // encabezado y coincidía con el nombre parcial.
  const denuncias = page.getByRole("heading", { name: "Denuncias abiertas", exact: true });
  await expect(aviso.or(denuncias)).toBeVisible();

  if (await aviso.isVisible()) {
    // La cabecera ya nombra el área: «Moderación de la comunidad», no la cuenta.
    await expect(
      page.getByRole("heading", { name: "Moderación de la comunidad", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Ir a mi cuenta" })).toHaveAttribute(
      "href",
      "/cuenta",
    );
    // Y no se filtra nada del panel: ni denuncias ni cuentas.
    await expect(denuncias).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Cuentas suspendidas" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("heading", { name: "Últimas acciones" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cuentas suspendidas" })).toBeVisible();
  }
});

test("el panel de comunidad carga cada pestaña por separado", async ({ page }) => {  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="email"]').fill("ana@wanderbibliothek.test");
  await dialog.locator('input[name="password"]').fill("demo1234");
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Abrir menú de cuenta" })).toBeVisible();

  await page.goto("/?view=community&tab=readers");
  await expect(page.locator(".reader-card:visible").first()).toBeVisible();
  // El snapshot ya solo trae la pestaña pedida: ni clubes ni listas.
  await expect(page.locator(".club-card:visible")).toHaveCount(0);

  await page.goto("/?view=community&tab=clubs");
  await expect(page.locator(".reader-card:visible")).toHaveCount(0);
});

test("un libro se puede previsualizar sin sesión y el acceso vuelve a él", async ({ page }) => {  // Calienta la ruta de ficha antes de medir el retorno del login: en un
  // servidor recién construido la primera compilación puede superar 15 s.
  await page.goto("/libro/lst_1");
  await page.goto("/");
  await waitForHydration(page);
  await page.locator(".book-card:visible .request-button").first().evaluate((element) =>
    (element as HTMLElement).click(),
  );
  const preview = page.getByRole("dialog");
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Entrar para pedirlo" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="email"]').fill("ana@wanderbibliothek.test");
  await dialog.locator('input[name="password"]').fill("demo1234");
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();

  await expect(page).toHaveURL(/\/libro\/lst_/, { timeout: 15_000 });
});

test("las páginas internas piden sesión y no enseñan el panel lateral", async ({ page }) => {
  await page.goto("/lectores");
  await expect(page).toHaveURL(/\/\?auth=1&next=/);

  // Sin sesión no hay menú: el panel lateral y la barra inferior son de quien
  // ha entrado, y la ventana de acceso se abre sola con el destino guardado.
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".mobile-bottom-nav")).toHaveCount(0);
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

test("sin sesión, «Explorar libros» abre el acceso en vez de navegar", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  // El catálogo exige sesión: el botón de la portada pide entrar antes de ir.
  await page.getByRole("button", { name: "Explorar libros" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Las dos pestañas de la ventana: entrar o crear cuenta.
  await expect(dialog.getByRole("button", { name: "Crear cuenta" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("la portada cuenta también los clubes de lectura", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  // El rótulo va en plural o en singular según la cifra, y cada cifra trae su
  // icono: la banda se comprueba por las dos cosas.
  await expect(page.locator(".hero-stats")).toContainText(/club(es)? de lectura/);
  await expect(page.locator(".hero-stats > .hero-stat")).toHaveCount(4);
});

test("el hub de comunidad no repite cifras ni buscador propio", async ({ page }) => {
  await loginAsDemo(page);

  for (const tab of ["clubs", "readers", "lists", "conversations"]) {
    await page.goto(`/comunidad?tab=${tab}`);
    await expect(page.locator(".community-tabs")).toBeVisible();
    // Las cifras salieron del hub y el buscador vive en la cabecera.
    await expect(page.locator(".community-figures")).toHaveCount(0);
    await expect(page.locator(".community-search")).toHaveCount(0);
    await expect(page.locator("#site-search-q")).toBeVisible();
  }
});

test("ofrecer un libro es una página con su URL, no una ventana", async ({ page }) => {
  await loginAsDemo(page);

  await page.locator(".sidebar").getByRole("button", { name: "Ofrecer un libro" }).click();
  await expect(page).toHaveURL(/\/ofrecer/);
  await expect(page.getByRole("heading", { name: "Cuéntanos qué libro ofreces" })).toBeVisible();
  await expect(page.locator("form.offer-form")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // La URL se puede recargar sin perder la página.
  await page.reload();
  await expect(page.locator("form.offer-form")).toBeVisible();
  // Y el enlace viejo (`?offer=1`) sigue llevando aquí.
  await page.goto("/?offer=1");
  await expect(page).toHaveURL(/\/ofrecer$/);
});

test("sin sesión no hay panel lateral ni barra de navegación", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".mobile-bottom-nav")).toHaveCount(0);
  // Lo que sí hay: la portada y el acceso.
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
  await expect(page.locator(".hero-stats")).toBeVisible();
});

test("en el menú, «Ofrecer un libro» va justo debajo de «Descubrir»", async ({ page }) => {
  await loginAsDemo(page);
  const menu = page.locator(".sidebar");
  // El raíl se coloca al hidratar y cambia de forma según el ancho: se espera a
  // que esté y luego se reintenta la medición en vez de medir a mitad de nada.
  await expect(menu.getByRole("button", { name: "Mi estantería" })).toBeVisible({
    timeout: 20_000,
  });
  // El raíl se coloca después de hidratar; se reintenta la medición hasta que
  // las tres posiciones son estables en lugar de medir a mitad de la transición.
  await expect(async () => {
    const descubrir = await menu.getByRole("button", { name: "Descubrir" }).boundingBox();
    const ofrecer = await menu.getByRole("button", { name: "Ofrecer un libro" }).boundingBox();
    const estanteria = await menu.getByRole("button", { name: "Mi estantería" }).boundingBox();

    expect(ofrecer!.y).toBeGreaterThan(descubrir!.y);
    expect(ofrecer!.y).toBeLessThan(estanteria!.y);
  }).toPass({ timeout: 15_000 });
});

test("las cifras de la portada quedan al pie del panel también en pantallas anchas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await loginAsDemo(page);

  const hero = await page.locator(".hero-banner").boundingBox();
  const stats = await page.locator(".hero-stats").boundingBox();
  // La diferencia es el relleno inferior del panel (24 px), no un hueco grande.
  expect(hero!.y + hero!.height - (stats!.y + stats!.height)).toBeLessThan(40);
  // Y las cuatro cifras siguen en una fila, no en una columna lateral.
  expect(Math.round(stats!.width)).toBeGreaterThan(Math.round(hero!.width) * 0.85);
});

test("la portada del libro también abre la ficha", async ({ page }) => {
  await loginAsDemo(page);

  const cover = page.locator(".book-card .cover-link").first();
  await expect(cover).toBeVisible();
  // El botón que va encima (guardar en el estante) no puede quedar tapado por
  // el enlace: se pulsa y la página no cambia.
  const favorite = page.locator(".book-card .favorite-button").first();
  if (await favorite.count()) {
    await favorite.click();
    await expect(page).toHaveURL(/\/$/);
  }

  await cover.click();
  await expect(page).toHaveURL(/\/libro\/lst_/);
});

test("las miniaturas sin portada no dejan imágenes rotas", async ({ page }) => {
  await loginAsDemo(page);
  await page.goto("/intercambios");

  // Los libros del seed no tienen imagen en los proveedores: el hueco se
  // resuelve con el icono, no con el icono de «imagen rota» del navegador.
  const rows = page.locator(".exchange-row");
  await expect(rows.first()).toBeVisible();
  const rotas = await page
    .locator(".mini-cover img")
    .evaluateAll((imgs) =>
      imgs.filter((img) => {
        const image = img as HTMLImageElement;
        return image.complete && image.naturalWidth === 0;
      }).length,
    );
  expect(rotas).toBe(0);

  await page.locator(".mini-cover").first().click();
  await expect(page).toHaveURL(/\/libro\/lst_/);
});

test("las cifras de la portada pasan a dos columnas cuando el ancho aprieta", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await loginAsDemo(page);

  // Cuatro columnas piden ~190 px cada una: por debajo, «Registrierte
  // Leser:innen» partía en dos líneas y la fila quedaba irregular.
  await expect(async () => {
    const cols = await page
      .locator(".hero-stats")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(cols).toBe(2);
  }).toPass({ timeout: 10_000 });

  const heights = await page
    .locator(".hero-stat-label")
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  // Todos los rótulos en una línea: ninguna columna más alta que otra.
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(4);
});

test("en el móvil cada cifra queda centrada sobre su rótulo", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForHydration(page);

  const desvios = await page.locator(".hero-stat").evaluateAll((els) =>
    els.map((el) => {
      const columna = el.getBoundingClientRect();
      const centro = (r: DOMRect) => r.x + r.width / 2;
      const cifra = el.querySelector("strong")!.getBoundingClientRect();
      const rotulo = el.querySelector(".hero-stat-label")!.getBoundingClientRect();
      return Math.round(Math.max(
        Math.abs(centro(cifra) - centro(columna)),
        Math.abs(centro(rotulo) - centro(columna)),
      ));
    }),
  );

  // Con la cifra pegada a la izquierda, «Tausch abgeschlossen» (dos líneas)
  // dejaba el número fuera del eje de su propio rótulo.
  expect(Math.max(...desvios)).toBeLessThanOrEqual(2);
});
