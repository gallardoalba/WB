import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { login, waitForHydration } from "./helpers";
import { localDatabase } from "./db";

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

test("la estantería añade libros al desplazarse, sin cambiar de página", async ({ page }) => {
  const database = localDatabase();
  if (!database) {
    test.skip(true, "La prueba crea datos y solo se ejecuta contra una base local.");
    return;
  }
  const source = database
    .prepare(
      `SELECT l.book_id, l.search_key
       FROM listings l JOIN books b ON b.id = l.book_id
       WHERE l.status = 'available' AND b.author <> 'Michail Bakunin'
       LIMIT 1`,
    )
    .get() as { book_id: string; search_key: string } | undefined;
  if (!source) {
    database.close();
    throw new Error("La base local no contiene un libro para preparar la prueba.");
  }

  const createdIds: string[] = [];
  const insert = database.prepare(
    `INSERT INTO listings
       (id, book_id, owner_id, condition, city, distance_km, status, search_key, created_at)
     VALUES (?, ?, 'usr_ana', 'Muy buen estado', 'Stuttgart', NULL, 'paused', ?, ?)`,
  );
  try {
    database.transaction(() => {
      for (let index = 0; index < 16; index += 1) {
        const id = `lst_${randomUUID()}`;
        createdIds.push(id);
        insert.run(id, source.book_id, source.search_key, new Date(Date.now() + index).toISOString());
      }
    })();
  } finally {
    database.close();
  }

  try {
    await login(page, "ana@wanderbibliothek.test");
    const shelf = page.locator(".sidebar").getByRole("button", { name: "Mi estantería" });
    await shelf.click();
    await page.getByRole("button", { name: "Mis publicaciones" }).click();
    // La pestaña se refleja en la URL: se espera a que la navegación termine
    // antes de medir, para no contar las tarjetas de la estantería anterior.
    await expect(page).toHaveURL(/shelf=mine/);
    const cards = page.locator(".book-card:visible");
    await expect(cards.first()).toBeVisible();
    const firstBatch = await cards.count();
    const url = page.url();

    // Al llegar al final se pide la tanda siguiente y las tarjetas se suman a
    // las que ya estaban: la lista no se sustituye ni cambia de página.
    await page.locator(".catalog-sentinel").scrollIntoViewIfNeeded();
    await expect.poll(() => cards.count(), { timeout: 20_000 }).toBeGreaterThan(firstBatch);
    expect(page.url()).toBe(url);
  } finally {
    const cleanup = localDatabase();
    if (!cleanup) throw new Error("No se pudo volver a abrir la base local para limpiar la prueba.");
    try {
      cleanup
        .prepare(`DELETE FROM listings WHERE id IN (${createdIds.map(() => "?").join(",")})`)
        .run(...createdIds);
    } finally {
      cleanup.close();
    }
  }
});

test("sin sesión el catálogo se puede ojear, pero pedir pide acceso", async ({ page }) => {
  await page.goto("/descubrir");
  await expect(page).toHaveURL(/\/descubrir$/);
  await expect(page.locator(".book-card:visible").first()).toBeVisible();

  // La tarjeta abre la ficha pública de la obra: se puede ojear sin cuenta y
  // el botón de pedir es el que pide acceso, con la vuelta guardada.
  await page.locator(".book-card:visible .card-link").first().click();
  await expect(page).toHaveURL(/\/werk\//, { timeout: 20_000 });
  await expect(page.locator(".public-work-context p")).toContainText(
    "Los ejemplares están en manos de quienes los ofrecen",
  );
  await page.getByRole("link", { name: "Entrar para pedirlo" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/next=/);
});

test("el tema claro/oscuro se conmuta y persiste", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  const toggle = page.locator(".theme-toggle");
  // `waitForHydration` solo garantiza que React montó *algo*: en `next dev` la
  // primera pulsación puede llegar antes de que el botón tenga su manejador y
  // se pierde. Se reintenta, pero mirando antes el estado: si el clic sí entró,
  // volver a pulsar lo desharía.
  async function setTheme(target: "dark" | "light") {
    await expect(async () => {
      const actual = await page.evaluate(() => document.documentElement.dataset.theme);
      if (actual === target) return;
      await toggle.evaluate((element) => (element as HTMLButtonElement).click());
      await expect(page.locator("html")).toHaveAttribute("data-theme", target, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  await setTheme("dark");
  expect(await page.evaluate(() => localStorage.getItem("b2p-theme"))).toBe("dark");

  await setTheme("light");
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
  // se confunde con la página de cuenta. El enlace lleva el prefijo del idioma
  // de la página (`/es/admin`), que es la URL canónica del castellano.
  await expect(
    page.getByRole("navigation", { name: "Administración" }).getByRole("link", {
      name: "Moderación",
    }),
  ).toHaveAttribute("href", "/es/admin");

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
  // El snapshot ya solo trae la pestaña pedida: ni listas.
  await page.goto("/?view=community&tab=lists");
  await expect(page.locator(".reader-card:visible")).toHaveCount(0);
});

test("una tarjeta sin sesión lleva a la ficha pública y el acceso vuelve a ella", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  // Clic por DOM y sin esperar al final: si la hidratación aún no ha llegado,
  // la navegación es de página completa y `evaluate` se queda sin contexto.
  await page
    .locator(".book-card:visible .request-button")
    .first()
    .evaluate((element) => (element as HTMLElement).click())
    .catch(() => {});

  // La tarjeta abre la ficha pública de la obra. Se comprueba el contenido y no
  // «que no haya ningún diálogo»: con la vista previa retirada el diálogo que
  // aparecía en CI venía del calentamiento de `/libro/…`, no de la tarjeta, y
  // hacía fallar la prueba por un detalle ajeno.
  await expect(page).toHaveURL(/\/werk\//, { timeout: 20_000 });
  await expect(page.locator("article.public-work h1")).toBeVisible({ timeout: 20_000 });

  // «Entrar para pedirlo» conserva el destino: la ficha de la obra que pide.
  await page.getByRole("link", { name: "Entrar para pedirlo" }).evaluate((element) =>
    (element as HTMLElement).click(),
  );
  const dialog = page.getByRole("dialog", { name: "Entra en Wanderbibliothek" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('input[name="email"]').fill("ana@wanderbibliothek.test");
  await dialog.locator('input[name="password"]').fill("demo1234");
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();

  // Vuelve a la ficha de la obra (no a la del ejemplar). El servidor tiene que
  // refrescar la sesión y compilar `/obra/…` en frío: 30 s de margen.
  await expect(page).toHaveURL(/\/obra\//, { timeout: 30_000 });
});

test("un enlace de acceso pendiente lleva al destino con la sesión ya abierta", async ({ page }) => {
  // Es el estado en el que se quedaba la barra cuando el servidor redirigía la
  // ficha justo después de entrar: sin la auto-reparación, la persona veía la
  // portada y el `?next=` no llevaba a ninguna parte.
  await loginAsDemo(page);
  await page.goto("/?auth=1&next=%2Flibro%2Flst_1");
  await expect(page).toHaveURL(/\/libro\/lst_1/, { timeout: 20_000 });
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

  const og = await request.get("/api/og/es");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toContain("image/png");
  // Un idioma que no existe no debe devolver una tarjeta a la que apuntar.
  expect((await request.get("/api/og/fr")).status()).toBe(404);
  // Cada página anuncia la tarjeta de su propio idioma: si no, un enlace en
  // alemán se comparte con el texto de otra lengua. Se compara contra el
  // `lang` del HTML porque `/de` responde con la portada (el alemán no lleva
  // prefijo) y la cookie del contexto decide el idioma en ese caso.
  for (const path of ["/es", "/en", "/"]) {
    const html = await (await request.get(path)).text();
    const lang = /<html lang="([a-z]{2})"/.exec(html)?.[1];
    expect(lang, `idioma de ${path}`).toBeTruthy();
    expect(html, `tarjeta de ${path}`).toContain(`/api/og/${lang}"`);
  }

  const sitemap = await request.get("/sitemap.xml");
  const body = await sitemap.text();
  expect(body).toContain("<loc>");
  expect(body).not.toContain("/listas/");
});

test("sin sesión, «Explorar libros» abre el catálogo público", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  // El catálogo es público: el botón de la portada navega en vez de pedir
  // cuenta. Pedir un libro concreto sí abre el acceso (se prueba arriba).
  await page.getByRole("button", { name: "Explorar libros" }).click();
  await expect(page).toHaveURL(/\/descubrir$/);
  await expect(page.locator(".book-card:visible").first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("«Descubrir todos los libros» abre el catálogo por arriba", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  // La portada llega en streaming: hasta que el estante no está de verdad
  // pintado, el documento mide poco y el desplazamiento se queda en cero —y el
  // cambio de contenido, al revelarse, lo cancela aunque ya hubiera empezado.
  // Esperar a la primera tarjeta es la señal de que el documento tiene su
  // altura definitiva. (`waitForHydration` solo dice que React montó.)
  await expect(page.locator(".book-card").first()).toBeVisible();

  // Con la portada desplazada al final, el catálogo se abría a media altura:
  // el desplazamiento a cero se hacía antes de que la vista nueva tuviera su
  // altura definitiva. Ahora lo hace el router al terminar la navegación.
  // El enlace vive en el pie (el botón suelto bajo el estante se retiró: ahora
  // se pasa de página con las flechas de la propia fila).
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

  await page.getByRole("link", { name: "Descubrir todos los libros" }).click();
  await expect(page).toHaveURL(/\/descubrir/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(40);
});

test("la portada enseña sus tres cifras", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  // La banda se comprueba por el número de columnas y por sus rótulos.
  await expect(page.locator(".hero-stats > .hero-stat")).toHaveCount(3);
  await expect(page.locator(".hero-stats")).toContainText(/libros? disponibles?/);
  await expect(page.locator(".hero-stats")).toContainText(/intercambios? hechos?/);
  await expect(page.locator(".hero-stats")).toContainText(/lectores? registrados?/);
});

test("el hub de comunidad no repite cifras ni buscador propio", async ({ page }) => {
  await loginAsDemo(page);

  for (const tab of ["readers", "lists", "conversations"]) {
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

test("un intercambio completado se archiva y se restaura", async ({ page }) => {
  await loginAsDemo(page);
  await page.goto("/intercambios");
  // El botón llega en el HTML del servidor: sin esperar a la hidratación, la
  // pulsación se pierde en un elemento que todavía no tiene eventos.
  await waitForHydration(page);

  // El seed deja un intercambio completado entre Ana y Lucía.
  const activo = page.locator(".exchange-row", { hasText: "Gott und der Staat" });
  await expect(activo).toBeVisible();
  await activo.locator(".exchange-archive").click();
  await expect(activo).toHaveCount(0);

  const tabs = page.locator(".exchange-tabs .category-tab");
  await tabs.nth(1).click();
  const archivado = page.locator(".exchange-row", { hasText: "Gott und der Staat" });
  await expect(archivado).toBeVisible();

  // Se devuelve a la lista para no dejar el seed a medias para otras pruebas.
  await archivado.locator(".exchange-archive").click();
  await expect(archivado).toHaveCount(0);
  await tabs.nth(0).click();
  await expect(page.locator(".exchange-row", { hasText: "Gott und der Staat" })).toBeVisible();
});

test("las tres cifras caben en una fila cuando el ancho aprieta", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await loginAsDemo(page);

  // Tres columnas piden ~190 px cada una y a este ancho siguen cabiendo: la
  // fila no se parte ni deja un hueco al lado de la última cifra.
  await expect(async () => {
    const cols = await page
      .locator(".hero-stats")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(cols).toBe(3);
  }).toPass({ timeout: 10_000 });

  const heights = await page
    .locator(".hero-stat-label")
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  // Todos los rótulos en una línea: ninguna columna más alta que otra.
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(4);
});

test("en el móvil las tres cifras siguen al mismo nivel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForHydration(page);

  const cajas = await page
    .locator(".hero-stat")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({
      y: Math.round(r.y),
      ancho: Math.round(r.width),
    })));
  // Las tres en la misma fila, cada una con su tercio: la banda se lee de un
  // vistazo y ninguna cifra cae debajo de las otras.
  expect(new Set(cajas.map((caja) => caja.y)).size).toBe(1);
  expect(cajas[0]!.ancho).toBeCloseTo(cajas[2]!.ancho, -1);
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
