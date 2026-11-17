import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { localDatabase } from "./db";
import { login, waitForHydration } from "./helpers";

/**
 * Primeros pasos y tour de bienvenida.
 *
 * La cuenta se crea en la base de pruebas copiando el hash de una cuenta de
 * demostración: así está de verdad vacía (sin perfil, publicaciones,
 * solicitudes ni seguimientos) y las cuatro tareas están pendientes, sin
 * depender de lo que otras pruebas hayan hecho con las cuentas de siempre.
 */
function freshAccount(): string {
  const db = localDatabase();
  if (!db) return "nueva@wanderbibliothek.test";
  const id = `usr_${randomUUID()}`;
  const email = `nueva-${randomUUID()}@wanderbibliothek.test`;
  try {
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, city, bio, created_at, locale)
       SELECT ?, ?, ?, password_hash, 'Görlitz', '', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'es'
         FROM users WHERE id = 'usr_clara'`,
    ).run(id, "Cuenta nueva", email);
  } finally {
    db.close();
  }
  return email;
}

test("una cuenta nueva ve el tour y la lista de primeros pasos", async ({ page }) => {
  const email = freshAccount();
  await login(page, email);

  // La ventana de acceso ya se ha cerrado: solo queda el tour.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("heading")).toHaveText("Publica tu primer ejemplar");
  await dialog.getByRole("button", { name: "Saltar el tour" }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByRole("region", { name: "Tus primeros pasos" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("0 de 4 completados");
  await expect(card.getByRole("link", { name: "Publicar" })).toBeVisible();

  await card.getByRole("button", { name: "Ocultar los primeros pasos" }).click();
  await expect(card).toBeHidden();

  // La marca vive en el navegador: recargar no devuelve la tarjeta.
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByRole("region", { name: "Tus primeros pasos" })).toBeHidden();
});

test("el tour se reabre con ?tour=1 y se cierra con Escape", async ({ page }) => {
  await login(page);
  await waitForHydration(page);

  await page.goto("/?tour=1");
  await waitForHydration(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("heading")).toHaveText("Publica tu primer ejemplar");

  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("heading")).toHaveText("Pide el ejemplar que te interese");
  await expect(dialog).toContainText("Paso 2 de 4");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("wb-tour-seen"))).toBe("1");
});
