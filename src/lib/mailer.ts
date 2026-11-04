/**
 * Entrega de correo.
 *
 * En desarrollo (o si no hay proveedor configurado) los mensajes se escriben en
 * la consola y en `.data/outbox/`, de forma que el flujo completo se pueda
 * probar sin servidor de correo. En producción, define `MAIL_WEBHOOK_URL` para
 * reenviarlos a tu proveedor (Resend, SES, Postmark…) o sustituye el cuerpo de
 * `deliver()` por el SDK que prefieras.
 */
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";

export type Mail = { to: string; subject: string; text: string };

const OUTBOX = path.join(process.cwd(), ".data", "outbox");

export async function sendMail(mail: Mail): Promise<{ delivered: boolean }> {
  const webhook = process.env.MAIL_WEBHOOK_URL;
  if (webhook) {
    try {
      const response = await fetch(webhook, {
        method: "POST",
        // Un proveedor lento no debe retener el registro ni la recuperación.
        signal: AbortSignal.timeout(5_000),
        headers: {
          "content-type": "application/json",
          ...(process.env.MAIL_WEBHOOK_TOKEN
            ? { authorization: `Bearer ${process.env.MAIL_WEBHOOK_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(mail),
      });
      if (response.ok) return { delivered: true };
      console.error("[mail] el proveedor respondió", response.status);
    } catch (error) {
      console.error("[mail] no se pudo entregar el correo", error);
    }
  }

  if (process.env.NODE_ENV === "production") {
    // En producción nunca se vuelca el cuerpo: los enlaces de verificación y
    // restablecimiento llevan tokens de un solo uso y el destinatario es un
    // dato personal. Se declara fallo para que la cola reintente.
    console.error(
      webhook
        ? "[mail] entrega fallida: el mensaje sigue en la cola"
        : "[mail] sin proveedor de correo configurado (MAIL_WEBHOOK_URL): el mensaje no se ha enviado",
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
