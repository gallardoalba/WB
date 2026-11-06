/**
 * Textos de los correos de cuenta, por idioma.
 *
 * Manda el idioma de **la cuenta** (`users.locale`), no el de quien pide el
 * envío: el correo va a una persona concreta y debe llegarle en el idioma en
 * que se registró, aunque el restablecimiento se pida desde otro dispositivo
 * o con otra cookie de idioma.
 *
 * Se compone por idioma, como `legal.ts` y `technical.ts`, y no con `translate`
 * porque el diccionario solo lleva cadenas de interfaz.
 */
import type { Locale } from "./locale";

export type MailText = { subject: string; text: string };

export function verificationMail(locale: Locale, link: string): MailText {
  return locale === "de"
    ? {
        subject: "Bestätige deine E-Mail bei Wanderbibliothek",
        text:
          "Öffne diesen Link, um deine E-Mail-Adresse zu bestätigen (er gilt 24 Stunden):\n" +
          `${link}\n\n` +
          "Falls die Nachricht nicht im Posteingang erscheint, schau bitte im Spam-Ordner nach.",
      }
    : {
        subject: "Confirma tu correo en Wanderbibliothek",
        text:
          "Abre este enlace para confirmar tu correo (caduca en 24 horas):\n" +
          `${link}\n\n` +
          "Si no ves este mensaje en la bandeja de entrada, mira en la carpeta de spam.",
      };
}

export function passwordResetMail(locale: Locale, link: string): MailText {
  return locale === "de"
    ? {
        subject: "Setze dein Passwort bei Wanderbibliothek zurück",
        text:
          "Öffne diesen Link, um ein neues Passwort zu wählen (er gilt 1 Stunde):\n" +
          `${link}\n\n` +
          "Falls die Nachricht nicht im Posteingang erscheint, schau bitte im Spam-Ordner nach.",
      }
    : {
        subject: "Restablece tu contraseña de Wanderbibliothek",
        text:
          "Abre este enlace para elegir una contraseña nueva (caduca en 1 hora):\n" +
          `${link}\n\n` +
          "Si no ves este mensaje en la bandeja de entrada, mira en la carpeta de spam.",
      };
}
