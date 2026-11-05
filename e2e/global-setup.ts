import { localDatabase } from "./db";

/**
 * El acceso tiene un límite de **20 entradas por cuenta cada 15 minutos** y la
 * suite entra muchas veces con las mismas cuentas de demostración. Con dos
 * pasadas seguidas se agotaba la cuota y las pruebas fallaban por un 429 que no
 * tenía nada que ver con lo que estaban comprobando (el botón de cuenta no
 * aparecía porque el login se había rechazado).
 *
 * Antes de cada ejecución se vacía la tabla de cuotas de la base **local** de
 * desarrollo. No se toca nada si las pruebas apuntan a un servidor ajeno
 * (`PLAYWRIGHT_BASE_URL`), porque ahí la base no es nuestra.
 */
export default function globalSetup(): void {
  // Contra un servidor ajeno no se toca nada. Si es local se limpia su base,
  // que es la que declara `WANDERBIBLIOTHEK_DB` (o la de `.data` por defecto).
  const db = localDatabase();
  if (!db) return;
  try {
    db.prepare("DELETE FROM throttle").run();
    // Las conversaciones directas y las claves van con el navegador que las
    // usó: se limpian para que cada pasada empiece sin mensajes ni huellas de
    // ejecuciones anteriores (si no, la segunda pasada encontraba una clave
    // publicada que no era la del navegador nuevo).
    for (const sql of [
      "DELETE FROM dm_messages",
      "DELETE FROM dm_threads",
      "DELETE FROM dm_reads",
      "DELETE FROM notifications WHERE type = 'direct'",
      "DELETE FROM public_key_history",
      "UPDATE users SET public_key = NULL, public_key_id = NULL",
    ]) {
      db.prepare(sql).run();
    }
  } catch {
    // Base aún sin migrar o bloqueada: el servidor la creará al arrancar.
  } finally {
    db?.close();
  }
}
