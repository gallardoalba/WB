import { expect, test, type Page } from "@playwright/test";
import { login, prepareDirectMessaging, waitForHydration } from "./helpers";

/**
 * Cifrado v2 en un navegador de verdad.
 *
 * La unidad prueba el ratchet con dobles del almacén; aquí se comprueba lo que
 * no se ve hasta juntarlo todo: activar el dispositivo en «Mi cuenta», escribir
 * a otra persona que también lo tiene, y que el texto siga ahí al recargar. Ese
 * último paso es el que faltaba: libolm gasta la clave del mensaje al abrirlo,
 * así que sin la caché del dispositivo el historial desaparecía.
 */

/** Activa el dispositivo v2 de este navegador (la cuenta ya tiene clave v1). */
async function activateV2(page: Page) {
  await page.goto("/cuenta");
  await waitForHydration(page);
  // El dispositivo v2 vive dentro del desplegable de cifrado de la cuenta.
  const resumen = page.locator("summary", { hasText: "Cifrado de mensajes" });
  const detalle = page.locator("details", { has: resumen });
  if (!(await detalle.evaluate((element) => element.hasAttribute("open")))) {
    await resumen.click();
  }

  const boton = page.getByRole("button", { name: /Activar el cifrado v2/ });
  await expect(boton).toBeVisible();
  await boton.click();

  // Si la cuenta ya cifraba en v1, el servidor pide la contraseña (`428`) y el
  // campo aparece al vuelo; si no, la activación termina directamente.
  const contrasena = page.locator("#v2-password");
  const activo = page.getByText("Este navegador ya tiene su dispositivo v2.");
  await expect(async () => {
    if (await activo.isVisible()) return;
    if (await contrasena.isVisible()) return;
    throw new Error("esperando a la activación");
  }).toPass({ timeout: 20_000 });

  if (await contrasena.isVisible()) {
    await contrasena.fill("demo1234");
    await expect(boton).toBeEnabled();
    await boton.click();
  }

  await expect(activo).toBeVisible({ timeout: 30_000 });

  // La cuenta lista su dispositivo y lo marca como el de este navegador: es la
  // pantalla desde la que se retira uno perdido.
  await expect(page.getByRole("heading", { name: "Dispositivos de cifrado" })).toBeVisible();
  await expect(page.locator(".v2-devices code")).toHaveCount(1);
}

test("dos dispositivos v2 se escriben y el hilo sobrevive a una recarga", async ({ browser }) => {
  test.setTimeout(240_000);

  const texto = "Mensaje que solo el otro aparato puede abrir.";
  const respuesta = "Y esta vuelve cifrada con el ratchet.";
  prepareDirectMessaging(["usr_ana", "usr_clara"]);

  const claraCtx = await browser.newContext();
  const clara = await claraCtx.newPage();
  await login(clara, "clara@wanderbibliothek.test");

  const anaCtx = await browser.newContext();
  const ana = await anaCtx.newPage();
  await login(ana, "ana@wanderbibliothek.test");

  await activateV2(clara);
  await activateV2(ana);

  // El compositor de v1 exige que las dos partes tengan clave publicada.
  await expect
    .poll(
      async () => {
        const response = await clara.request.get("/api/direct/usr_ana");
        const payload = (await response.json()) as { peer: { keyId: string | null } };
        return payload.peer.keyId;
      },
    )
    .toBeTruthy();

  await clara.goto("/u/usr_ana");
  await waitForHydration(clara);
  const composer = clara.getByRole("dialog");
  await expect(async () => {
    if (await composer.isVisible()) return;
    await clara.getByRole("button", { name: "Mensaje" }).click({ timeout: 2000 });
    await expect(composer).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });

  await composer.getByLabel("Escribe un mensaje").fill(texto);
  await composer.getByRole("button", { name: "Enviar" }).click();
  await expect(composer.getByText(texto).last()).toBeVisible();

  // La otra parte lo descifra con su dispositivo. Esto es lo que fallaba cuando
  // los diálogos pasaban `keyId` en lugar de `senderDeviceId`.
  await ana.goto("/u/usr_clara?dm=1");
  await waitForHydration(ana);
  const thread = ana.getByRole("dialog");
  await expect(thread).toBeVisible();
  await expect(thread.getByText(texto).last()).toBeVisible({ timeout: 20_000 });

  // Y sigue ahí tras recargar: el ratchet ya gastó esa clave.
  await ana.reload();
  await waitForHydration(ana);
  await expect(ana.getByRole("dialog").getByText(texto).last()).toBeVisible({ timeout: 20_000 });

  await thread.getByLabel("Escribe un mensaje").fill(respuesta);
  await thread.getByRole("button", { name: "Enviar" }).click();
  await expect(thread.getByText(respuesta).last()).toBeVisible();

  // Lo que escribió cada parte tampoco se pierde al volver a abrir el hilo: lo
  // propio sale de la caché del dispositivo (el sobre fue para la otra persona).
  await clara.goto("/u/usr_ana?dm=1");
  await waitForHydration(clara);
  await expect(clara.getByRole("dialog").getByText(texto).last()).toBeVisible({ timeout: 20_000 });
  await expect(clara.getByRole("dialog").getByText(respuesta).last()).toBeVisible({
    timeout: 20_000,
  });

  await claraCtx.close();
  await anaCtx.close();
});
