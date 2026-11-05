import { expect, test } from "@playwright/test";
import { login, prepareDirectMessaging, waitForHydration } from "./helpers";

/**
 * Mensajería directa entre dos personas que se siguen.
 *
 * La muestra deja a Ana y Clara siguiéndose. Cada navegador tiene su propia
 * clave (contexto distinto = otro almacén local), así que esto también comprueba
 * que el cifrado es de extremo a extremo de verdad: el servidor solo guarda el
 * sobre y cada parte lo abre con su clave privada.
 */
test("dos seguidoras mutuas se escriben con mensajes cifrados de extremo a extremo", async ({
  browser,
}) => {
  // En desarrollo la primera visita a /u/[id] compila la ruta: la hidratación
  // puede tardar bastante más que el tiempo por defecto.
  test.setTimeout(120_000);

  const texto = "¿Te viene bien quedar el sábado en la Schlossplatz?";
  const respuesta = "Perfecto, llevo el ejemplar de Marcuse.";

  // Las dos cuentas se siguen, no están bloqueadas y empiezan sin clave: cada
  // contexto de prueba trae la suya y el servidor no deja cambiarla sin
  // contraseña.
  prepareDirectMessaging(["usr_ana", "usr_clara"]);

  // Cada contexto es un navegador distinto, con su propia clave privada.
  const claraCtx = await browser.newContext();
  const clara = await claraCtx.newPage();
  await login(clara, "clara@wanderbibliothek.test");

  const anaCtx = await browser.newContext();
  const ana = await anaCtx.newPage();
  await login(ana, "ana@wanderbibliothek.test");

  // Las dos claves se publican al cargar la aplicación; se espera a que estén
  // las dos antes de escribir para no mirar una conversación a medias.
  await expect
    .poll(async () => {
      const response = await clara.request.get("/api/direct/usr_ana");
      const payload = (await response.json()) as { peer: { keyId: string | null } };
      return payload.peer.keyId;
    })
    .toBeTruthy();

  await clara.goto("/u/usr_ana");
  await waitForHydration(clara);

  const composer = clara.getByRole("dialog");
  // La primera pulsación puede llegar antes de que el botón esté hidratado.
  await expect(async () => {
    if (await composer.isVisible()) return;
    await clara.getByRole("button", { name: "Mensaje" }).click({ timeout: 2000 });
    await expect(composer).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await expect(composer.getByText("Cifrado de extremo a extremo")).toBeVisible();
  await composer.getByLabel("Escribe un mensaje").fill(texto);
  await composer.getByRole("button", { name: "Enviar" }).click();
  await expect(composer.getByText(texto).last()).toBeVisible();

  // La otra parte abre la conversación desde el aviso del perfil y responde.
  await ana.goto("/u/usr_clara?dm=1");
  await waitForHydration(ana);
  const thread = ana.getByRole("dialog");
  await expect(thread).toBeVisible();
  await expect(thread.getByText(texto).last()).toBeVisible();
  await thread.getByLabel("Escribe un mensaje").fill(respuesta);
  await thread.getByRole("button", { name: "Enviar" }).click();
  await expect(thread.getByText(respuesta).last()).toBeVisible();

  // Y el mensaje de vuelta aparece descifrado en la primera ventana.
  await clara.goto("/u/usr_ana?dm=1");
  await waitForHydration(clara);
  await expect(clara.getByRole("dialog").getByText(respuesta).last()).toBeVisible();

  await claraCtx.close();
  await anaCtx.close();
});

test("sin seguimiento mutuo el perfil no ofrece mensajes", async ({ page }) => {
  // Diego sigue a Ana, pero Ana no lo sigue a él... y a la inversa tampoco hay
  // botón: la conversación solo se abre entre seguidores mutuos.
  await login(page, "diego@wanderbibliothek.test");
  await page.goto("/u/usr_marcos");
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Mensaje" })).toHaveCount(0);
});
