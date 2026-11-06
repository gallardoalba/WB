import { expect, type Page } from "@playwright/test";
import { localDatabase } from "./db";

/** Espera a que el layout cliente haya hidratado y aplicado el tema. */
export async function waitForHydration(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
}

/**
 * Abre la ventana de acceso y entra con una cuenta de demostración.
 *
 * En `next dev` la primera pulsación de «Entrar» puede llegar antes de que el
 * botón esté hidratado y se pierde, así que se reintenta hasta que la ventana
 * aparece. Sin esto, la prueba fallaba por un clic perdido y no por lo que
 * estaba comprobando.
 */
export async function login(page: Page, email = "clara@wanderbibliothek.test") {
  await page.goto("/");
  await waitForHydration(page);
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await page.getByRole("button", { name: "Entrar", exact: true }).click({ timeout: 2000 });
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await dialog.locator('input[name="email"]').fill(email);
  await dialog.locator('input[name="password"]').fill("demo1234");
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();
  // Con `next dev` la primera visita a cada ruta compila en caliente y el
  // armazón puede tardar; 10 s se quedaban cortos en las pruebas que cambian de
  // página justo después de entrar.
  await expect(page.getByRole("button", { name: "Abrir menú de cuenta" })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Prepara dos cuentas para probar la mensajería directa: se siguen mutuamente,
 * no hay bloqueos entre ellas y ninguna tiene clave publicada ni mensajes.
 *
 * Cada navegador de prueba genera su propia clave, así que una clave publicada
 * por una prueba anterior (u otro contexto) haría que esta no pudiera escribir:
 * el servidor solo acepta cambios de clave con la contraseña. El seguimiento se
 * asegura porque otras pruebas lo activan y lo desactivan.
 */
export function prepareDirectMessaging([a, b]: [string, string]): void {
  const db = localDatabase();
  if (!db) return;
  try {
    const now = new Date().toISOString();
    db.prepare("DELETE FROM dm_messages").run();
    db.prepare("DELETE FROM dm_threads").run();
    db.prepare("DELETE FROM dm_reads").run();
    db.prepare("DELETE FROM notifications WHERE type = 'direct'").run();
    db.prepare(
      "DELETE FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)",
    ).run(a, b, b, a);
    const follow = db.prepare(
      "INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)",
    );
    follow.run(a, b, now);
    follow.run(b, a, now);
    db.prepare("DELETE FROM public_key_history WHERE user_id IN (?, ?)").run(a, b);
    // Desde la v40 las claves viven en `user_keys` (una por ranura). Si solo se
    // limpian las columnas antiguas, el navegador de la prueba encuentra una
    // clave publicada que no es la suya y el envío queda deshabilitado.
    db.prepare("DELETE FROM user_keys WHERE user_id IN (?, ?)").run(a, b);
    db.prepare(
      "UPDATE users SET public_key = NULL, public_key_id = NULL WHERE id IN (?, ?)",
    ).run(a, b);
  } finally {
    db.close();
  }
}
