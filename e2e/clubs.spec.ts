import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("el club de demostración enseña lectura, foro y votación", async ({ page }) => {
  await login(page);
  await page.goto("/clubes");
  const tarjeta = page.locator(".club-card", { hasText: "Los martes de la biblioteca" });
  await expect(tarjeta).toBeVisible();
  await tarjeta.getByRole("link", { name: "Los martes de la biblioteca" }).click();

  // Dónde se ve el club, que antes no se guardaba.
  await expect(page.locator(".club-meta", { hasText: "Cafetería del Stadtmuseum" })).toBeVisible();

  // Foro: los mensajes sembrados se ven y se puede escribir uno nuevo.
  const foro = page.locator("#foro");
  await expect(foro).toBeVisible();
  await expect(foro.getByText("Propongo que el siguiente sea de no ficción")).toBeVisible();
  // Texto único por ejecución: la base de la demo se reutiliza entre pasadas y
  // el compositor conserva el mensaje hasta que la petición vuelve.
  const mensaje = `Prueba de punta a punta ${Date.now()}: nos vemos el martes.`;
  await foro.getByRole("textbox", { name: "Tu mensaje para el club" }).fill(mensaje);
  await foro.getByRole("button", { name: "Publicar mensaje" }).click();
  await expect(foro.locator(".comment-text", { hasText: mensaje })).toHaveCount(1);
  await expect(foro.getByText("Mensaje publicado.")).toBeVisible();

  // Votación abierta: votar cambia el contador sin recargar la página.
  const votacion = page.locator("#votacion");
  await expect(votacion).toBeVisible();
  const opcion = votacion.locator(".club-poll-option").first();
  await opcion.click();
  await expect(votacion.locator(".club-poll-option[aria-pressed='true']")).toHaveCount(1);
});

test("quien no es miembro no ve el foro ni la votación", async ({ page }) => {
  // Diego no está en el club sembrado.
  await login(page, "diego@wanderbibliothek.test");
  await page.goto("/clubes");
  await page
    .locator(".club-card", { hasText: "Los martes de la biblioteca" })
    .getByRole("link", { name: "Los martes de la biblioteca" })
    .click();

  await expect(page.locator("#foro")).toContainText("El foro solo lo leen los miembros");
  await expect(page.locator("#foro textarea")).toHaveCount(0);
  await expect(page.locator("#votacion")).toHaveCount(0);
});

test("quien dirige el club lo edita en una ventana y el cierre pide confirmación", async ({
  page,
}) => {
  await login(page);
  await page.goto("/clubes/clb_seed_1");

  // El botón de ajustes está arriba, en la fila de acciones, y no al pie.
  const acciones = page.locator(".club-share-actions");
  await expect(acciones.getByRole("button", { name: "Editar club" })).toBeVisible();

  // Quien creó el club no ve un botón para unirse (antes devolvía 409).
  await expect(page.locator(".club-owner")).toContainText("Lo diriges tú");
  await expect(page.getByRole("button", { name: /Unirme|Pedir entrar|En el club/ })).toHaveCount(0);

  await acciones.getByRole("button", { name: "Editar club" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByLabel("Nombre")).toHaveValue("Los martes de la biblioteca");

  // Cerrar el club vive dentro de la edición y pide un segundo paso.
  const cerrar = dialogo.getByRole("button", { name: "Cerrar el club" });
  await expect(dialogo.getByRole("button", { name: "Sí, cerrar el club" })).toHaveCount(0);
  await cerrar.click();
  await expect(dialogo.getByRole("button", { name: "Sí, cerrar el club" })).toBeVisible();
  await expect(dialogo).toContainText("No se puede deshacer");
  // Se deshace sin cerrar nada: el club sigue en pie.
  await dialogo.getByRole("button", { name: "No, dejarlo" }).click();
  await expect(dialogo.getByRole("button", { name: "Sí, cerrar el club" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("quien dirige el club nombra moderadores y ellos ven las solicitudes", async ({ page }) => {
  await login(page);
  await page.goto("/clubes/clb_seed_1");

  // El menú ofrece moderar, pero solo con una persona elegida.
  await page.getByRole("button", { name: "Gestionar miembros" }).click();
  const panel = page.locator(".club-members-menu-panel");
  const moderar = panel.getByRole("button", { name: /^(Hacer|Quitar) moderador$/ });
  await expect(moderar).toBeDisabled();
  await panel.locator("select").selectOption({ label: "Ana Martínez" });

  // La base de la demo se reutiliza entre pasadas: si Ana ya moderaba (por una
  // ejecución interrumpida), se deja primero como estaba al principio.
  if ((await moderar.innerText()).includes("Quitar")) {
    await moderar.click();
    await expect(panel.getByText("Ana Martínez ya no modera el club.")).toBeVisible();
  }

  await moderar.click();
  await expect(panel.getByText("Ana Martínez ahora modera el club.")).toBeVisible();

  // La insignia aparece en la lista de miembros y el botón cambia de sentido.
  await page.reload();
  await expect(page.locator(".club-members")).toContainText("moderador");
  await expect(page.locator(".club-members", { hasText: "Ana Martínez" })).toContainText(
    "Stuttgart · moderador",
  );

  // La prueba deja el club como lo encontró.
  await page.getByRole("button", { name: "Gestionar miembros" }).click();
  await panel.locator("select").selectOption({ label: "Ana Martínez" });
  await panel.getByRole("button", { name: "Quitar moderador" }).click();
  await expect(panel.getByText("Ana Martínez ya no modera el club.")).toBeVisible();
});
