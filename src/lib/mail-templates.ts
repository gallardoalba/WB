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
  if (locale === "de") {
    return {
      subject: "Bestätige deine E-Mail bei Wanderbibliothek",
      text:
        "Öffne diesen Link, um deine E-Mail-Adresse zu bestätigen (er gilt 24 Stunden):\n" +
        `${link}\n\n` +
        "Falls die Nachricht nicht im Posteingang erscheint, schau bitte im Spam-Ordner nach.",
    };
  }
  if (locale === "en") {
    return {
      subject: "Confirm your email at Wanderbibliothek",
      text:
        "Open this link to confirm your email address (it is valid for 24 hours):\n" +
        `${link}\n\n` +
        "If the message does not appear in your inbox, please check your spam folder.",
    };
  }
  return {
    subject: "Confirma tu correo en Wanderbibliothek",
    text:
      "Abre este enlace para confirmar tu correo (caduca en 24 horas):\n" +
      `${link}\n\n` +
      "Si no ves este mensaje en la bandeja de entrada, mira en la carpeta de spam.",
  };
}

export function passwordResetMail(locale: Locale, link: string): MailText {
  if (locale === "de") {
    return {
      subject: "Setze dein Passwort bei Wanderbibliothek zurück",
      text:
        "Öffne diesen Link, um ein neues Passwort zu wählen (er gilt 1 Stunde):\n" +
        `${link}\n\n` +
        "Falls die Nachricht nicht im Posteingang erscheint, schau bitte im Spam-Ordner nach.",
    };
  }
  if (locale === "en") {
    return {
      subject: "Reset your Wanderbibliothek password",
      text:
        "Open this link to choose a new password (it is valid for 1 hour):\n" +
        `${link}\n\n` +
        "If the message does not appear in your inbox, please check your spam folder.",
    };
  }
  return {
    subject: "Restablece tu contraseña de Wanderbibliothek",
    text:
      "Abre este enlace para elegir una contraseña nueva (caduca en 1 hora):\n" +
      `${link}\n\n` +
      "Si no ves este mensaje en la bandeja de entrada, mira en la carpeta de spam.",
  };
}

/**
 * Aviso de suspensión. Incluye el motivo, el plazo y el enlace de apelación:
 * quien no puede entrar no debe quedarse sin saber por qué ni cómo recurrir.
 */
export function suspensionMail(
  locale: Locale,
  input: { reason: string; until: string; link: string },
): MailText {
  if (locale === "de") {
    return {
      subject: "Dein Konto bei Wanderbibliothek wurde gesperrt",
      text:
        `Dein Konto ist bis zum ${input.until} gesperrt.\n\n` +
        `Grund: ${input.reason}\n\n` +
        "Du kannst die Entscheidung über diesen Link anfechten (er gilt 30 Tage):\n" +
        `${input.link}\n\n` +
        "Wenn du die Sperre nicht nachvollziehen kannst, wende dich an das Moderations-Team der Instanz.",
    };
  }
  if (locale === "en") {
    return {
      subject: "Your Wanderbibliothek account has been suspended",
      text:
        `Your account is suspended until ${input.until}.\n\n` +
        `Reason: ${input.reason}\n\n` +
        "You can appeal the decision through this link (valid for 30 days):\n" +
        `${input.link}\n\n` +
        "If you do not recognise this sanction, contact the instance's moderation team.",
    };
  }
  return {
    subject: "Tu cuenta de Wanderbibliothek está suspendida",
    text:
      `Tu cuenta está suspendida hasta el ${input.until}.\n\n` +
      `Motivo: ${input.reason}\n\n` +
      "Puedes apelar la decisión desde este enlace (vale 30 días):\n" +
      `${input.link}\n\n` +
      "Si no reconoces esta sanción, escribe al equipo de moderación de la instancia.",
  };
}

/** Respuesta a una apelación: si se estima, la suspensión ya está levantada. */
export function appealResolvedMail(
  locale: Locale,
  input: { upheld: boolean; stillSuspended: boolean; resolution: string },
): MailText {
  if (locale === "de") {
    const outcome = input.upheld
      ? "Dein Einspruch war erfolgreich: die Sperre wurde aufgehoben. Du kannst dich wieder anmelden."
      : input.stillSuspended
        ? "Dein Einspruch wurde geprüft. Die Sperre bleibt bestehen."
        : "Dein Einspruch wurde geprüft. Die Sperre war bei dieser Antwort bereits abgelaufen.";
    return { subject: "Antwort auf deinen Einspruch bei Wanderbibliothek", text: `${outcome}\n\n${input.resolution}` };
  }
  if (locale === "en") {
    const outcome = input.upheld
      ? "Your appeal was upheld and the suspension has been lifted. You can sign in again."
      : input.stillSuspended
        ? "Your appeal has been reviewed. The suspension remains in place."
        : "Your appeal has been reviewed. The suspension had already ended when this reply was written.";
    return { subject: "Reply to your appeal at Wanderbibliothek", text: `${outcome}\n\n${input.resolution}` };
  }
  const outcome = input.upheld
    ? "Tu apelación ha sido estimada y la suspensión se ha levantado. Ya puedes volver a entrar."
    : input.stillSuspended
      ? "Tu apelación se ha revisado. La suspensión se mantiene."
      : "Tu apelación se ha revisado. La suspensión ya había terminado cuando se escribió esta respuesta.";
  return { subject: "Respuesta a tu apelación en Wanderbibliothek", text: `${outcome}\n\n${input.resolution}` };
}
