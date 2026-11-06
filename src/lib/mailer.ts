/**
 * Entrega de correo.
 *
 * Dos caminos, en este orden:
 *
 * 1. `BREVO_API_KEY` + `MAIL_FROM`: la API de Brevo directamente. No hay
 *    intermediario que mantener ni una URL pública que proteger.
 * 2. `MAIL_WEBHOOK_URL`: un `POST {to, subject, text}` a lo que sea (un Worker
 *    propio, Resend, SES, Postmark…). Si están los dos, manda este.
 *
 * En desarrollo (o sin proveedor configurado) el mensaje se escribe en la
 * consola y en `.data/outbox/`, de forma que el flujo completo se pueda probar
 * sin servidor de correo. En producción, un fallo se declara como no entregado
 * y la cola (`mail_outbox`) lo reintenta con espera creciente.
 */
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";

export type Mail = { to: string; subject: string; text: string };

const OUTBOX = path.join(process.cwd(), ".data", "outbox");
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
/** Un proveedor lento no debe retener el registro ni la recuperación. */
const TIMEOUT_MS = 5_000;
/** Brevo rechaza nombres de remitente de más de 70 caracteres. */
const MAX_SENDER_NAME = 70;

/**
 * `Nombre <correo@dominio>` o solo `correo@dominio`. Devuelve `null` si la
 * dirección no es válida, para que el arranque avise en vez de dejar un
 * remitente roto que Brevo rechazaría en cada envío.
 */
export function parseSender(raw: string | undefined): { email: string; name?: string } | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const angled = /^(.*?)\s*<([^<>]+)>\s*$/.exec(value);
  const email = (angled ? angled[2]! : value).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  const name = (angled?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  return name ? { email, name: name.slice(0, MAX_SENDER_NAME) } : { email };
}

/** Brevo explica el fallo en `{code, message}`; sin ese detalle, un 401 por IP
 * no autorizada parece un error de clave y se busca en el sitio equivocado. */
async function brevoReason(response: Response): Promise<string> {
  let detail = "";
  try {
    const parsed = JSON.parse((await response.text()).slice(0, 400)) as {
      code?: unknown;
      message?: unknown;
    };
    detail = [parsed.code, parsed.message]
      .filter((part): part is string => typeof part === "string")
      .join(" · ");
  } catch {
    // Sin JSON legible se queda el código HTTP, que ya se registra aparte.
  }
  const hint =
    response.status === 401 || response.status === 403
      ? " · ¿clave revocada o IP no autorizada en Brevo (Seguridad → IP autorizadas)?"
      : response.status === 400
        ? " · ¿remitente o dominio sin autenticar en Brevo?"
        : "";
  return `${detail || "sin detalle"}${hint}`;
}

async function postBrevo(
  mail: Mail,
  apiKey: string,
  sender: { email: string; name?: string },
): Promise<boolean> {
  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [{ email: mail.to }],
        subject: mail.subject,
        textContent: mail.text,
      }),
    });
    // Brevo responde 201 al aceptar el mensaje, no 200.
    if (response.ok) return true;
    console.error("[mail] Brevo rechazó el envío", response.status, await brevoReason(response));
    return false;
  } catch (error) {
    console.error("[mail] no se pudo contactar con Brevo", error);
    return false;
  }
}

async function postWebhook(url: string, mail: Mail): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        ...(process.env.MAIL_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${process.env.MAIL_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(mail),
    });
    if (response.ok) return true;
    console.error("[mail] el proveedor respondió", response.status);
    return false;
  } catch (error) {
    console.error("[mail] no se pudo entregar el correo", error);
    return false;
  }
}

/** Intenta la entrega con el proveedor configurado. */
async function deliver(mail: Mail): Promise<{ configured: boolean; delivered: boolean }> {
  const webhook = process.env.MAIL_WEBHOOK_URL?.trim();
  if (webhook) return { configured: true, delivered: await postWebhook(webhook, mail) };

  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (apiKey) {
    const sender = parseSender(process.env.MAIL_FROM);
    if (!sender) {
      console.error("[mail] BREVO_API_KEY sin un MAIL_FROM válido: no hay remitente con el que enviar");
      return { configured: true, delivered: false };
    }
    return { configured: true, delivered: await postBrevo(mail, apiKey, sender) };
  }

  return { configured: false, delivered: false };
}

export async function sendMail(mail: Mail): Promise<{ delivered: boolean }> {
  const attempt = await deliver(mail);
  if (attempt.delivered) return { delivered: true };

  if (process.env.NODE_ENV === "production") {
    // En producción nunca se vuelca el cuerpo: los enlaces de verificación y
    // restablecimiento llevan tokens de un solo uso y el destinatario es un
    // dato personal. Se declara fallo para que la cola reintente.
    console.error(
      attempt.configured
        ? "[mail] entrega fallida: el mensaje sigue en la cola"
        : "[mail] sin proveedor de correo configurado (BREVO_API_KEY + MAIL_FROM, o MAIL_WEBHOOK_URL): el mensaje no se ha enviado",
    );
    return { delivered: false };
  }

  try {
    mkdirSync(OUTBOX, { recursive: true });
    appendFileSync(
      path.join(OUTBOX, "outbox.log"),
      `${new Date().toISOString()}\t${mail.to}\t${mail.subject}\n${mail.text}\n\n`,
      { mode: 0o600 },
    );
  } catch (error) {
    console.error("[mail] no se pudo escribir el buzón de desarrollo", error);
  }
  console.info(`[mail] ${mail.subject} → ${mail.to}\n${mail.text}`);
  return { delivered: true };
}
