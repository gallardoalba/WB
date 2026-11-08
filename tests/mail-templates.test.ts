/**
 * Textos de los correos de cuenta en los tres idiomas.
 *
 * El alemán es el idioma por defecto y el inglés se publicó después: una rama
 * sin cubrir significa que un correo sale en el idioma equivocado o sin el
 * enlace. Lo que se fija aquí, para las dos plantillas:
 *
 * - el enlace viaja tal cual (lleva el token en el fragmento),
 * - hay aviso de mirar en spam, porque el dominio nuevo cae ahí,
 * - cada idioma tiene su propio asunto y su propia frase,
 * - el alemán y el castellano son el respaldo si llega un idioma desconocido.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordResetMail, verificationMail, type MailText } from "../src/lib/mail-templates.ts";
import { LOCALES, type Locale } from "../src/lib/locale.ts";

const ENLACE = "https://wanderbibliothek.org/verificar#token=" + "a".repeat(64);

const MARCADORES: Record<Locale, { spam: RegExp; buzon: RegExp }> = {
  de: { spam: /Spam-Ordner/, buzon: /Posteingang/ },
  es: { spam: /carpeta de spam/, buzon: /bandeja de entrada/ },
  en: { spam: /spam folder/, buzon: /inbox/ },
};

test("las dos plantillas existen en los tres idiomas y llevan el enlace", () => {
  for (const locale of LOCALES) {
    for (const [nombre, plantilla] of [
      ["confirmación", verificationMail],
      ["restablecimiento", passwordResetMail],
    ] as const) {
      const mail: MailText = plantilla(locale, ENLACE);
      assert.ok(mail.subject.trim().length > 0, `${nombre} en ${locale} sin asunto`);
      assert.ok(mail.text.includes(ENLACE), `${nombre} en ${locale} sin el enlace`);
      assert.match(mail.text, MARCADORES[locale].spam, `${nombre} en ${locale} sin aviso de spam`);
      assert.match(mail.text, MARCADORES[locale].buzon, `${nombre} en ${locale} sin el buzón`);
    }
  }
});

test("cada idioma tiene su asunto: no se cuela una traducción en otra", () => {
  for (const plantilla of [verificationMail, passwordResetMail]) {
    const asuntos = LOCALES.map((locale) => plantilla(locale, ENLACE).subject);
    assert.equal(new Set(asuntos).size, LOCALES.length, `asuntos repetidos: ${asuntos.join(" | ")}`);
  }
  assert.match(verificationMail("de", ENLACE).subject, /Bestätige/);
  assert.match(verificationMail("es", ENLACE).subject, /Confirma/);
  assert.match(verificationMail("en", ENLACE).subject, /Confirm/);
  assert.match(passwordResetMail("de", ENLACE).subject, /Passwort/);
  assert.match(passwordResetMail("es", ENLACE).subject, /contraseña/);
  assert.match(passwordResetMail("en", ENLACE).subject, /password/);
});

test("la vigencia del enlace se explica en cada idioma", () => {
  // 24 horas para confirmar y 1 hora para cambiar la contraseña: si el texto no
  // lo dice, quien lo recibe no sabe cuánto corre.
  assert.match(verificationMail("en", ENLACE).text, /24 hours/);
  assert.match(verificationMail("de", ENLACE).text, /24 Stunden/);
  assert.match(verificationMail("es", ENLACE).text, /24 horas/);
  assert.match(passwordResetMail("en", ENLACE).text, /1 hour/);
  assert.match(passwordResetMail("de", ENLACE).text, /1 Stunde/);
  assert.match(passwordResetMail("es", ENLACE).text, /1 hora/);
});
