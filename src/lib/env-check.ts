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

export type EnvSeverity = "error" | "warn";

export type EnvIssue = {
  /** Nombre de la variable afectada. */
  key: string;
  severity: EnvSeverity;
  message: string;
};

export type EnvLike = Record<string, string | undefined>;

const has = (env: EnvLike, key: string) => Boolean(env[key]?.trim());

/** La clave de cifrado debe ser de 32 bytes, en hexadecimal o en base64. */
function isValidEncryptionKey(value: string): boolean {
  const raw = value.trim();
  const bytes = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex").length
    : Buffer.from(raw, "base64").length;
  return bytes === 32;
}

/**
 * Devuelve los problemas del entorno. Con `BOOK2PEER_SKIP_ENV_CHECK=1` no se
 * comprueba nada: sirve para un entorno de pruebas donde se asume la carencia.
 */
export function checkEnv(env: EnvLike = process.env): EnvIssue[] {
  if (env.NODE_ENV !== "production") return [];
  if (env.BOOK2PEER_SKIP_ENV_CHECK === "1") return [];

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

  if (!has(env, "MAIL_WEBHOOK_URL")) {
    error(
      "MAIL_WEBHOOK_URL",
      "Sin proveedor de correo nadie puede confirmar su cuenta (en producción es obligatorio para publicar) ni recuperar la contraseña.",
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

  if (!has(env, "MAINTENANCE_TOKEN")) {
    warn(
      "MAINTENANCE_TOKEN",
      "El cron de mantenimiento responderá 404: no se purgan sesiones, cuotas ni avisos viejos, y los correos fallidos no se reintentan.",
    );
  }

  if (env.TRUST_PROXY !== "1") {
    warn(
      "TRUST_PROXY",
      "Detrás de un proxy, todas las peticiones comparten la cuota de la clave «direct»: un cliente puede agotar los límites de todo el sitio.",
    );
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

  if (!has(env, "BOOK2PEER_DB")) {
    warn(
      "BOOK2PEER_DB",
      "La base quedará dentro del directorio de la aplicación (.data/): un despliegue nuevo se la lleva por delante.",
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
        "Revisa deploy/README.md; para arrancar igualmente define BOOK2PEER_SKIP_ENV_CHECK=1.",
    );
  }
  return issues;
}
