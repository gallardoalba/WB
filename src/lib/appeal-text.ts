import type { Locale } from "./locale";

export type AppealTexts = {
  title: string;
  intro: string;
  label: string;
  hint: string;
  submit: string;
  sending: string;
  success: string;
  invalidTitle: string;
  invalidBody: string;
  back: string;
  error: string;
  linkLabel: string;
  linkSubmit: string;
  linkSending: string;
  linkSuccess: string;
  linkError: string;
};

/** Textos de la página de apelación, por idioma (no pasan por el diccionario). */
export function appealTexts(locale: Locale): AppealTexts {
  if (locale === "de") {
    return {
      title: "Einspruch gegen eine Sperre",
      intro:
        "Wenn du die Sperre deines Kontos für nicht richtig hältst, erzähl uns, was passiert ist. Das Team prüft es und antwortet dir per E-Mail.",
      label: "Dein Einspruch",
      hint: "Mindestens 20 Zeichen. Bitte keine persönlichen Daten anderer Personen angeben.",
      submit: "Einspruch senden",
      sending: "Wird gesendet…",
      success:
        "Einspruch gesendet. Das Team prüft ihn und antwortet dir per E-Mail.",
      invalidTitle: "Dieser Link ist nicht gültig",
      invalidBody:
        "Vielleicht ist er abgelaufen oder wurde schon verwendet. Wenn du Einspruch einlegen möchtest, fordere unten mit der E-Mail deines Kontos einen neuen Link an.",
      back: "Zur Startseite",
      error: "Der Einspruch konnte nicht gesendet werden.",
      linkLabel: "E-Mail des Kontos",
      linkSubmit: "Neuen Link anfordern",
      linkSending: "Wird gesendet…",
      linkSuccess:
        "Wenn zu dieser E-Mail eine Sperre gilt, erhältst du in wenigen Minuten einen neuen Link.",
      linkError: "Der Link konnte nicht angefordert werden. Versuch es später erneut.",
    };
  }
  if (locale === "en") {
    return {
      title: "Appeal a suspension",
      intro:
        "If you believe your account was suspended unfairly, tell us what happened. The team will review it and reply by email.",
      label: "Your appeal",
      hint: "At least 20 characters. Do not include other people's personal data.",
      submit: "Send appeal",
      sending: "Sending…",
      success: "Appeal sent. The team will review it and reply by email.",
      invalidTitle: "This link is not valid",
      invalidBody:
        "It may have expired or already been used. If you need to appeal, request a new link with your account email below.",
      back: "Back to the home page",
      error: "The appeal could not be sent.",
      linkLabel: "Account email",
      linkSubmit: "Send a new link",
      linkSending: "Sending…",
      linkSuccess:
        "If that email has a suspension in force, you will receive a new link in a few minutes.",
      linkError: "The link could not be requested. Try again later.",
    };
  }
  return {
    title: "Apelar una sanción",
    intro:
      "Si crees que la suspensión de tu cuenta no es correcta, cuéntanos qué ha pasado. El equipo la revisará y te responderá por correo.",
    label: "Tu apelación",
    hint: "Al menos 20 caracteres. No incluyas datos personales de otras personas.",
    submit: "Enviar apelación",
    sending: "Enviando…",
    success: "Apelación enviada. El equipo la revisará y te responderá por correo.",
    invalidTitle: "Este enlace no es válido",
    invalidBody:
      "Puede haber caducado o haberse usado ya. Si necesitas apelar, pide un enlace nuevo con el correo de tu cuenta.",
    back: "Volver al inicio",
    error: "No se pudo enviar la apelación.",
    linkLabel: "Correo de la cuenta",
    linkSubmit: "Enviar un enlace nuevo",
    linkSending: "Enviando…",
    linkSuccess:
      "Si ese correo tiene una sanción vigente, recibirás un enlace nuevo en unos minutos.",
    linkError: "No se pudo pedir el enlace. Inténtalo más tarde.",
  };
}
