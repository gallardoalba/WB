/**
 * Comprobación del entorno de despliegue.
 *
 * El objetivo es que una configuración incompleta se vea **al arrancar** y no
 * tres días después, cuando alguien intenta verificar su correo o activar la
 * administración. Cada regla explica la consecuencia real de la variable que
 * falta, porque el mensaje es lo que se lee en el `journalctl` del servidor.
 *
 * Solo se aplica en producción: en desarrollo no hay TLS, ni proveedor de
 * correo, ni cron, y la app está pensada para funcionar sin nada de eso.
 */

import { parseSender } from "./mailer";

export type EnvSeverity = "error" | "warn";

export type EnvIssue = {
  /** Nombre de la variable afectada. */
  key: string;
  severity: EnvSeverity;
  message: string;
};

export type EnvLike = Record<string, string | undefined>;

const has = (env: EnvLike, key: string) => Boolean(env[key]?.trim());

/** Las claves de 32 bytes (cifrado y copias) van en hexadecimal o en base64. */
function isKeyOf32Bytes(value: string): boolean {
  const raw = value.trim();
  const bytes = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex").length
    : Buffer.from(raw, "base64").length;
  return bytes === 32;
}

/** La clave de cifrado debe ser de 32 bytes, en hexadecimal o en base64. */
function isValidEncryptionKey(value: string): boolean {
  return isKeyOf32Bytes(value);
}

/** Ruta absoluta: una relativa depende del directorio de la release. */
function isAbsolutePath(value: string): boolean {
  return value.trim().startsWith("/");
}

/**
 * Devuelve los problemas del entorno. Con `WANDERBIBLIOTHEK_SKIP_ENV_CHECK=1` no se
 * comprueba nada: sirve para un entorno de pruebas donde se asume la carencia.
 */
export function checkEnv(env: EnvLike = process.env): EnvIssue[] {
  if (env.NODE_ENV !== "production") return [];
  if (env.WANDERBIBLIOTHEK_SKIP_ENV_CHECK === "1") return [];

  const issues: EnvIssue[] = [];
  const error = (key: string, message: string) => issues.push({ key, severity: "error", message });
  const warn = (key: string, message: string) => issues.push({ key, severity: "warn", message });

  const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  if (!siteUrl) {
    error(
      "NEXT_PUBLIC_SITE_URL",
      "Falta la URL pública: el sitemap y los canonical apuntarían a localhost.",
    );
  } else if (!siteUrl.startsWith("https://")) {
    // La cookie de sesión es __Host- (exige Secure): sobre HTTP el navegador la
    // descarta y el acceso entra en bucle.
    error(
      "NEXT_PUBLIC_SITE_URL",
      "Debe empezar por https://: la cookie de sesión es __Host- y el navegador la descarta sobre HTTP.",
    );
  }

  // Correo: o la API de Brevo (clave y remitente) o un webhook propio. Sin
  // ninguno de los dos no hay confirmación de cuenta ni recuperación.
  if (!has(env, "MAIL_WEBHOOK_URL") && !has(env, "BREVO_API_KEY")) {
    error(
      "MAIL_WEBHOOK_URL",
      "Sin proveedor de correo (`BREVO_API_KEY` + `MAIL_FROM`, o `MAIL_WEBHOOK_URL`) nadie puede confirmar su cuenta (en producción es obligatorio para publicar) ni recuperar la contraseña.",
    );
  } else if (!has(env, "MAIL_WEBHOOK_URL")) {
    // Con Brevo el remitente no es opcional: la API lo exige y, sin él, cada
    // envío acabaría en un 400 que solo se ve en la cola del cron.
    if (!has(env, "MAIL_FROM")) {
      error(
        "MAIL_FROM",
        "Brevo necesita un remitente autenticado en la cuenta: `MAIL_FROM=\"Wanderbibliothek <no-reply@tu-dominio>\"`.",
      );
    } else if (!parseSender(env.MAIL_FROM)) {
      error(
        "MAIL_FROM",
        "No es una dirección válida: se admite `correo@dominio` o `Nombre <correo@dominio>`.",
      );
    }
  } else if (has(env, "BREVO_API_KEY")) {
    warn(
      "BREVO_API_KEY",
      "Están el webhook y Brevo a la vez: manda el webhook y esta clave no se usa. Deja solo uno de los dos.",
    );
  }

  if (!has(env, "APP_ENCRYPTION_KEY")) {
    error(
      "APP_ENCRYPTION_KEY",
      "Sin clave no se pueden guardar secretos TOTP, y sin 2FA la administración responde 403 en producción.",
    );
  } else if (!isValidEncryptionKey(env.APP_ENCRYPTION_KEY!)) {
    error(
      "APP_ENCRYPTION_KEY",
      "Debe tener 32 bytes en hexadecimal (64 caracteres) o en base64.",
    );
  }

  // Claves antiguas para poder rotar sin perder los secretos ya guardados.
  const clavesAntiguas = (env.APP_ENCRYPTION_OLD_KEYS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of clavesAntiguas) {
    const separator = entry.indexOf(":");
    const clave = separator > 0 ? entry.slice(separator + 1) : entry;
    if (!isValidEncryptionKey(clave)) {
      error(
        "APP_ENCRYPTION_OLD_KEYS",
        `La entrada «${entry.slice(0, 16)}…» no es una clave de 32 bytes (hex o base64).`,
      );
    }
  }
  if (clavesAntiguas.length > 0 && !has(env, "APP_ENCRYPTION_KEY_ID")) {
    warn(
      "APP_ENCRYPTION_KEY_ID",
      "Sin un id para la clave activa se usa uno derivado de la propia clave: funciona, pero un nombre legible («2026-11») hace más fácil saber qué clave toca retirar de APP_ENCRYPTION_OLD_KEYS.",
    );
  }

  if (!has(env, "MAINTENANCE_TOKEN")) {
    warn(
      "MAINTENANCE_TOKEN",
      "El cron de mantenimiento responderá 404: no se purgan sesiones, cuotas ni avisos viejos, y los correos fallidos no se reintentan.",
    );
  } else if ((env.MAINTENANCE_TOKEN ?? "").trim().length < 24) {
    warn(
      "MAINTENANCE_TOKEN",
      "Es más corto de 24 caracteres: un token débil protege una tarea de escritura expuesta a Internet. Genéralo con `openssl rand -hex 32`.",
    );
  }

  if (env.TRUST_PROXY !== "1") {
    warn(
      "TRUST_PROXY",
      "Detrás de un proxy, todas las peticiones comparten la cuota de la clave «direct»: un cliente puede agotar los límites de todo el sitio.",
    );
  } else if (has(env, "TRUSTED_PROXY_HOPS")) {
    const hops = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "", 10);
    if (!Number.isFinite(hops) || hops < 1) {
      warn(
        "TRUSTED_PROXY_HOPS",
        "No es un entero ≥ 1: se usarán 1 salto, así que con un CDN delante la IP del cliente sería la del CDN y todas sus visitas compartirían cuota.",
      );
    }
  }

  if (env.SEED_DEMO === "1") {
    warn(
      "SEED_DEMO",
      "Está sembrando cuentas de demostración con contraseña conocida en producción.",
    );
  }

  if (has(env, "ADMIN_PASSWORD")) {
    warn(
      "ADMIN_PASSWORD",
      "Retírala del entorno cuando el administrador ya exista: no hace falta para arrancar y queda legible en la configuración del servicio.",
    );
  }

  // El bot de Mastodon es opcional, pero un token mal copiado (con espacios, a
  // medias) falla en silencio: la cola se llena y el perfil no publica nada.
  if (has(env, "MASTODON_TOKEN")) {
    const token = env.MASTODON_TOKEN?.trim() ?? "";
    if (token.length < 20) {
      warn(
        "MASTODON_TOKEN",
        "Parece incompleto (un token de Mastodon ronda los 40 caracteres): el bot encolará avisos que la instancia rechazará.",
      );
    }
    const instance = env.MASTODON_INSTANCE?.trim();
    if (instance && !instance.startsWith("https://")) {
      warn(
        "MASTODON_INSTANCE",
        "Tiene que empezar por https://: el token viaja en una cabecera y el bot se queda apagado si no lo es.",
      );
    }
  }
  // Un par a medias no crea la cuenta y el operador se queda esperando: se
  // avisa ahora, no cuando falle el primer acceso a /admin.
  if (has(env, "ADMIN_EMAIL") !== has(env, "ADMIN_PASSWORD")) {
    warn(
      has(env, "ADMIN_EMAIL") ? "ADMIN_PASSWORD" : "ADMIN_EMAIL",
      "El administrador inicial necesita las dos variables: con solo una no se crea ninguna cuenta. Usa `npm run admin:create` si prefieres hacerlo a mano.",
    );
  }

  // Las páginas legales se alimentan de estas variables. Sin ellas, el aviso
  // legal queda visiblemente incompleto, y el Impressum (§ 5 DDG) es
  // obligatorio para un servicio abierto en Alemania.
  const legalMissing = ["LEGAL_CONTROLLER", "LEGAL_ADDRESS", "LEGAL_CONTACT_EMAIL"].filter(
    (key) => !has(env, key),
  );
  if (legalMissing.length > 0) {
    warn(
      legalMissing[0]!,
      `Faltan datos del responsable (${legalMissing.join(", ")}): /privacidad y /aviso-legal se publican incompletos. El aviso legal es obligatorio en Alemania y la política de privacidad, exigible por el RGPD.`,
    );
  }

  if (env.REQUIRE_EMAIL_VERIFICATION === "0") {
    warn(
      "REQUIRE_EMAIL_VERIFICATION",
      "Permite publicar y escribir sin confirmar el correo; el aviso de cuenta sin verificar deja de proteger nada.",
    );
  }

  if (!has(env, "ERROR_WEBHOOK_URL")) {
    warn(
      "ERROR_WEBHOOK_URL",
      "Los errores solo quedan en la consola del servicio; no habrá aviso si algo falla de madrugada.",
    );
  }

  if (!has(env, "WANDERBIBLIOTHEK_DB")) {
    warn(
      "WANDERBIBLIOTHEK_DB",
      "La base quedará dentro del directorio de la aplicación (.data/): un despliegue nuevo se la lleva por delante.",
    );
  } else if (!isAbsolutePath(env.WANDERBIBLIOTHEK_DB!)) {
    warn(
      "WANDERBIBLIOTHEK_DB",
      "Es una ruta relativa: se resuelve contra el directorio de la release y una actualización puede dejar la base atrás. Usa una ruta absoluta fuera de la aplicación.",
    );
  }

  // Copias de seguridad: la rotación y el cifrado solo se descubren a las 03:20,
  // así que una clave mal escrita se avisa al arrancar en vez de dejar copias
  // en claro (o ninguna) durante semanas.
  if (!has(env, "WANDERBIBLIOTHEK_BACKUP_KEY")) {
    warn(
      "WANDERBIBLIOTHEK_BACKUP_KEY",
      "Sin clave, la copia diaria se guarda en claro: el fichero lleva correos, hashes de contraseña y el texto cifrado de los mensajes. Genérala con `openssl rand -hex 32` y guárdala fuera del servidor.",
    );
  } else if (!isKeyOf32Bytes(env.WANDERBIBLIOTHEK_BACKUP_KEY!)) {
    warn(
      "WANDERBIBLIOTHEK_BACKUP_KEY",
      "No son 32 bytes en hexadecimal (64 caracteres) ni en base64: la copia diaria fallará y no habrá respaldo cifrado. Genérala con `openssl rand -hex 32`.",
    );
  }
  // Una copia en el mismo disco que la base no protege de lo que más pasa
  // (el disco y el servidor se van juntos). Se puede sacar de aquí con el gancho
  // o trayéndola desde otra máquina (`deploy/backup-pull.sh`), que es lo
  // recomendado cuando el servidor no tiene destino al que empujar.
  if (!has(env, "WANDERBIBLIOTHEK_BACKUP_HOOK") && env.WANDERBIBLIOTHEK_BACKUP_OFFSITE !== "1") {
    warn(
      "WANDERBIBLIOTHEK_BACKUP_HOOK",
      "La copia se queda en el mismo servidor que la base: si se pierde el disco, se pierden las dos. Define un gancho que la suba fuera (`rclone`, `scp`, `restic`…) o trae las copias desde otra máquina con `deploy/backup-pull.sh` y marca `WANDERBIBLIOTHEK_BACKUP_OFFSITE=1`.",
    );
  }
  // El registro es el punto de entrada favorito de los robots. Sin captcha
  // solo lo frenan la cuota por IP, el campo trampa y la verificación de correo.
  // Ojo con los nombres: el secreto es `TURNSTILE_SECRET` y la clave del
  // cliente `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (esta se incrusta en el bundle al
  // compilar, así que añadirla exige reconstruir, no solo reiniciar).
  if (!has(env, "TURNSTILE_SECRET") || !has(env, "NEXT_PUBLIC_TURNSTILE_SITE_KEY")) {
    warn(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "Turnstile está apagado: el registro solo tiene la cuota por IP, el campo trampa y el tiempo mínimo. Con `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (se incrusta al compilar) y `TURNSTILE_SECRET` se activa sin tocar código.",
    );
  }
  if (
    has(env, "WANDERBIBLIOTHEK_BACKUP_DIR") &&
    !isAbsolutePath(env.WANDERBIBLIOTHEK_BACKUP_DIR!)
  ) {
    warn(
      "WANDERBIBLIOTHEK_BACKUP_DIR",
      "Es una ruta relativa: las copias acabarían dentro de la release y se perderían en el siguiente despliegue. Usa una ruta absoluta.",
    );
  }

  return issues;
}

/** Líneas listas para el registro del servidor. */
export function formatEnvIssues(issues: EnvIssue[]): string[] {
  return issues.map(
    (issue) => `[env] ${issue.severity === "error" ? "ERROR" : "AVISO"} ${issue.key}: ${issue.message}`,
  );
}

/**
 * Imprime los problemas y, si hay alguno grave, aborta el arranque: es
 * preferible un servicio que no levanta y un error claro a una web que parece
 * funcionar y rechaza a todo el mundo.
 */
export function assertEnv(
  env: EnvLike = process.env,
  log: (line: string) => void = console.error,
): EnvIssue[] {
  const issues = checkEnv(env);
  for (const line of formatEnvIssues(issues)) log(line);

  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `Entorno de producción incompleto (${errors.map((issue) => issue.key).join(", ")}). ` +
        "Revisa deploy/README.md; para arrancar igualmente define WANDERBIBLIOTHEK_SKIP_ENV_CHECK=1.",
    );
  }
  return issues;
}
