/**
 * Textos legales: política de privacidad y aviso legal en los tres idiomas.
 *
 * Estos documentos son una obligación, no decoración: el aviso legal (§ 5 DDG)
 * tiene que nombrar al titular, su dirección postal y un contacto rápido, y las
 * tres versiones tienen que contar **lo mismo** (art. 13 RGPD) para que nadie
 * reciba menos información por leer la web en otro idioma.
 *
 * Aquí se fija eso: la configuración sale del entorno (nunca del código), los
 * datos opcionales aparecen solo si existen y, si faltan los obligatorios, el
 * texto lo dice en vez de inventarse una dirección.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  imprintDocument,
  legalConfig,
  maskContact,
  privacyDocument,
  type LegalConfig,
  type LegalDocument,
} from "../src/lib/legal.ts";
import { privacyDocumentEN } from "../src/lib/legal-en.ts";
import { projectDocument } from "../src/lib/project.ts";

const completo: LegalConfig = {
  controller: "Ada Lovelace",
  address: "Calle Mayor 1, 04109 Leipzig",
  contact: "hola@wanderbibliothek.org",
  vatId: "DE123456789",
  phone: "+49 341 000000",
  register: "Vereinsregister 42",
  emailProvider: null,
  turnstileWidgetEnabled: false,
  turnstileVerificationEnabled: false,
  webPushEnabled: false,
  errorWebhookEnabled: false,
  complete: true,
};

const incompleto: LegalConfig = {
  controller: "",
  address: "",
  contact: "",
  vatId: "",
  phone: "",
  register: "",
  emailProvider: null,
  turnstileWidgetEnabled: false,
  turnstileVerificationEnabled: false,
  webPushEnabled: false,
  errorWebhookEnabled: false,
  complete: false,
};

/** Todo el texto del documento, para buscar en él sin recorrer la estructura. */
function texto(documento: LegalDocument): string {
  return [
    documento.title,
    ...documento.intro,
    ...documento.sections.flatMap((seccion) => [seccion.heading, ...seccion.body]),
  ].join("\n");
}

test("la configuración legal sale del entorno y exige titular, dirección y contacto", () => {
  const vacia = legalConfig({});
  assert.equal(vacia.complete, false, "sin nada configurado no está completo");

  const parcial = legalConfig({ LEGAL_CONTROLLER: "Ada" });
  assert.equal(parcial.complete, false, "con un solo dato tampoco");

  const llena = legalConfig({
    LEGAL_CONTROLLER: "  Ada Lovelace  ",
    LEGAL_ADDRESS: "Calle Mayor 1",
    LEGAL_CONTACT_EMAIL: "hola@example.test",
    LEGAL_VAT_ID: " DE123 ",
    LEGAL_PHONE: " +49 341 000000 ",
    LEGAL_REGISTER: " Vereinsregister 42 ",
  });
  assert.equal(llena.complete, true);
  assert.equal(llena.controller, "Ada Lovelace", "se recortan los espacios");
  assert.equal(llena.vatId, "DE123", "también en los datos opcionales");
  assert.equal(llena.phone, "+49 341 000000");
  assert.equal(llena.register, "Vereinsregister 42");
  assert.equal(legalConfig({ BREVO_API_KEY: "test-key" }).emailProvider, null);
  assert.equal(
    legalConfig({ BREVO_API_KEY: "test-key", MAIL_FROM: "mail@example.test" }).emailProvider,
    "brevo",
  );
  const servicios = legalConfig({
    MAIL_WEBHOOK_URL: "https://mail.example.test/send",
    BREVO_API_KEY: "not-a-real-key",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-test-key",
    TURNSTILE_SECRET: "not-a-real-secret",
    VAPID_PUBLIC_KEY: "public-test-vapid",
    VAPID_PRIVATE_KEY: "not-a-real-private-key",
    ERROR_WEBHOOK_URL: "https://errors.example.test/receive",
  });
  assert.equal(servicios.emailProvider, "webhook", "el webhook tiene precedencia sobre Brevo");
  assert.equal(servicios.turnstileWidgetEnabled, true);
  assert.equal(servicios.turnstileVerificationEnabled, true);
  assert.equal(servicios.webPushEnabled, true);
  assert.equal(servicios.errorWebhookEnabled, true);

  // Un contacto en blanco no cuenta como contacto.
  const sinContacto = legalConfig({
    LEGAL_CONTROLLER: "Ada",
    LEGAL_ADDRESS: "Calle Mayor 1",
    LEGAL_CONTACT_EMAIL: "   ",
  });
  assert.equal(sinContacto.complete, false);
});

test("la política informa del widget Turnstile aunque no haya verificación del servidor", () => {
  const servicios = legalConfig({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-test-key" });
  assert.equal(servicios.turnstileWidgetEnabled, true);
  assert.equal(servicios.turnstileVerificationEnabled, false);

  for (const locale of ["de", "es", "en"] as const) {
    const body = texto(privacyDocument(locale, servicios));
    assert.match(body, /Cloudflare Turnstile/);
    assert.doesNotMatch(body, /Serverprüfung|verificación del servidor|server-side verification/i);
  }

  const soloVerificacion = legalConfig({ TURNSTILE_SECRET: "server-test-secret" });
  assert.equal(soloVerificacion.turnstileWidgetEnabled, false);
  assert.equal(soloVerificacion.turnstileVerificationEnabled, true);
  for (const locale of ["de", "es", "en"] as const) {
    const body = texto(privacyDocument(locale, soloVerificacion));
    assert.match(body, /Serverprüfung|verificación del servidor|server-side verification/i);
    assert.doesNotMatch(
      body,
      /Der Browser lädt das Widget|El navegador carga el widget|The browser loads the widget/,
    );
  }
});

test("la dirección de contacto se publica enmascarada", () => {
  // El aviso legal tiene que dar un medio de contacto, pero no regalárselo a
  // los rastreadores de correo: en el texto va `nombre[at]dominio[dot]tld`.
  // Las direcciones de ejemplo son inventadas a propósito: el repositorio es
  // público y no debe servir para cosechar la de verdad.
  assert.equal(maskContact("lectora@ejemplo.org"), "lectora[at]ejemplo[dot]org");
  assert.equal(maskContact("  hola@wanderbibliothek.org  "), "hola[at]wanderbibliothek[dot]org");
  // Los puntos del usuario se quedan: lo que se tapa es el dominio.
  assert.equal(maskContact("nombre.apellido@ejemplo.es"), "nombre.apellido[at]ejemplo[dot]es");
  // Lo que ya no es una dirección se deja como está en vez de romperse.
  assert.equal(maskContact("pendiente de configurar"), "pendiente de configurar");
  assert.equal(maskContact("sin-arroba"), "sin-arroba");
  assert.equal(maskContact("@suelta"), "@suelta");
  assert.equal(maskContact("cola@"), "cola@");

  // Y en los tres idiomas el documento sale enmascarado, sin ningún `@`.
  for (const locale of ["de", "es", "en"] as const) {
    for (const documento of [imprintDocument(locale, completo), privacyDocument(locale, completo)]) {
      const cuerpo = texto(documento);
      assert.ok(
        cuerpo.includes(maskContact(completo.contact)),
        `${locale}: el contacto va enmascarado (${maskContact(completo.contact)})`,
      );
      assert.equal(
        cuerpo.includes(completo.contact),
        false,
        `${locale}: la dirección con @ no puede aparecer en el HTML`,
      );
    }
  }
});

test("el aviso legal nombra al titular, la dirección y el contacto en alemán y en español", () => {
  const aleman = imprintDocument("de", completo);
  assert.equal(aleman.title, "Impressum");
  assert.match(texto(aleman), /§ 5 DDG/);
  for (const dato of [completo.controller, completo.address, maskContact(completo.contact)]) {
    assert.ok(texto(aleman).includes(dato), `el aviso legal alemán menciona ${dato}`);
  }
  // Los datos opcionales se etiquetan en alemán.
  assert.match(texto(aleman), /Telefon: \+49 341 000000/);
  assert.match(texto(aleman), /Registereintrag: Vereinsregister 42/);
  assert.match(texto(aleman), /USt-IdNr\.: DE123456789/);

  const espanol = imprintDocument("es", completo);
  assert.equal(espanol.title, "Aviso legal");
  for (const dato of [completo.controller, completo.address, maskContact(completo.contact)]) {
    assert.ok(texto(espanol).includes(dato), `el aviso legal español menciona ${dato}`);
  }
  assert.match(texto(espanol), /Titular: Ada Lovelace/);
  assert.match(texto(espanol), /Registro: Vereinsregister 42/);
  assert.match(texto(espanol), /NIF\/IVA: DE123456789/);
});

test("los datos opcionales del aviso legal no aparecen si no existen", () => {
  const sinOpcionales: LegalConfig = {
    ...completo,
    vatId: "",
    phone: "",
    register: "",
  };
  for (const locale of ["de", "es", "en"] as const) {
    const documento = texto(imprintDocument(locale, sinOpcionales));
    assert.ok(documento.includes(completo.controller), `${locale}: sigue nombrando al titular`);
    for (const etiqueta of ["Telefon", "Teléfono", "Phone", "Register", "Registro", "USt-IdNr", "NIF"]) {
      assert.equal(
        documento.includes(`${etiqueta}:`),
        false,
        `${locale}: no debe inventarse «${etiqueta}»`,
      );
    }
  }
});

test("sin datos configurados el aviso legal pide configurarlos en los tres idiomas", () => {
  for (const locale of ["de", "es", "en"] as const) {
    const documento = texto(imprintDocument(locale, incompleto));
    assert.match(
      documento,
      /LEGAL_CONTROLLER/,
      `${locale}: el texto señala qué variables faltan en vez de inventar datos`,
    );
  }
});

test("la política de privacidad cubre las mismas secciones en los tres idiomas", () => {
  const documentos = ["de", "es", "en"].map((locale) =>
    privacyDocument(locale as "de" | "es" | "en", completo),
  );
  const [aleman, espanol, ingles] = documentos;
  assert.equal(aleman.sections.length, espanol.sections.length);
  assert.equal(ingles.sections.length, espanol.sections.length, "misma estructura en inglés");

  // Cada versión lleva intro, fecha y el nombre del responsable.
  for (const documento of documentos) {
    assert.ok(documento.intro.length > 0);
    assert.match(documento.updated, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(texto(documento).includes(completo.controller));
    assert.ok(texto(documento).includes(maskContact(completo.contact)));
  }

  // Y con la configuración vacía también avisan de que falta configurarla.
  for (const locale of ["de", "es", "en"] as const) {
    assert.match(texto(privacyDocument(locale, incompleto)), /LEGAL_CONTROLLER/);
  }
});

test("la política refleja proveedores opcionales activos y los nuevos flujos de privacidad", () => {
  const servicios = legalConfig({
    MAIL_WEBHOOK_URL: "https://mail.example.test/send",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-test-key",
    TURNSTILE_SECRET: "not-a-real-secret",
    VAPID_PUBLIC_KEY: "public-test-vapid",
    VAPID_PRIVATE_KEY: "not-a-real-private-key",
    ERROR_WEBHOOK_URL: "https://errors.example.test/receive",
  });

  for (const locale of ["de", "es", "en"] as const) {
    const body = texto(privacyDocument(locale, servicios));
    assert.match(body, /webhook/i);
    assert.match(body, /Cloudflare Turnstile/);
    assert.match(body, /Web Push/);
    assert.match(body, /error webhook|Webhook de errores|Fehler-Webhook/i);
    assert.doesNotMatch(body, /not-a-real-secret|not-a-real-token|not-a-real-private-key/);
  }

  const allLanguages = (["de", "es", "en"] as const).map((locale) =>
    texto(privacyDocument(locale, incompleto)),
  );
  for (const body of allLanguages) {
    assert.match(body, /noindex/);
    assert.match(body, /7 days|7 días|7 Tage/);
    assert.doesNotMatch(body, /Google Books/);
  }
});

test("los textos legales contemplan Austria sin cambiar la jurisdicción del operador", () => {
  const privacidad = {
    de: texto(privacyDocument("de", completo)),
    es: texto(privacyDocument("es", completo)),
    en: texto(privacyDocument("en", completo)),
  };
  assert.match(privacidad.de, /§ 165 Abs\. 3 TKG 2021/);
  assert.match(privacidad.es, /§ 165\.3 TKG 2021/);
  assert.match(privacidad.en, /§ 165\(3\) TKG 2021/);
  assert.match(privacidad.de, /Datenschutzbehörde \(DSB\)/);
  assert.match(privacidad.es, /Datenschutzbehörde \(DSB\)/);
  assert.match(privacidad.en, /Datenschutzbehörde, DSB/);

  const impressum = texto(imprintDocument("de", completo));
  assert.match(impressum, /§ 5 ECG/);
  assert.match(impressum, /§ 25 MedienG/);
  assert.match(impressum, /Nutzung aus Österreich ändert den Sitz/);
});

test("los textos legales nombran el alojamiento real, no un hueco", () => {
  // El proveedor de infraestructura es un destinatario del art. 13 RGPD y una
  // pieza del impreso: si vuelve un «el proveedor donde se ejecuta el
  // servicio», la política deja de decir a quién se envían los datos.
  for (const documento of [
    privacyDocument("de", completo),
    privacyDocument("es", completo),
    privacyDocumentEN(completo),
  ]) {
    assert.match(texto(documento), /netcup GmbH/);
  }
  for (const documento of [privacyDocument("de", completo), privacyDocument("es", completo)]) {
    assert.doesNotMatch(texto(documento), /donde se ejecuta el servicio|bei dem dieser Dienst läuft/);
  }
});

/** Todo el texto de un documento largo, para buscar en él sin recorrer la estructura. */
function textoLargo(documento: ReturnType<typeof projectDocument>): string {
  return [
    documento.title,
    ...documento.intro,
    ...documento.sections.flatMap((seccion) => [
      seccion.heading,
      ...seccion.blocks.flatMap((bloque) => {
        if (bloque.kind === "p") return [bloque.text];
        if (bloque.kind === "list") return bloque.items;
        if (bloque.kind === "terms") return bloque.items.map((item) => `${item.label} ${item.text}`);
        if (bloque.kind === "code") return bloque.lines;
        if (bloque.kind === "table") return [...bloque.head, ...bloque.rows.flat()];
        return bloque.items.map((item) => `${item.label} ${item.href} ${item.note}`);
      }),
    ]),
  ].join("\n");
}

test("la página del proyecto tampoco publica el correo sin enmascarar", () => {
  // El contacto de `/projekt` sale de la misma configuración que el Impressum y
  // pasa por el mismo enmascarado: `nombre[at]dominio[dot]tld`, nunca con `@`.
  for (const locale of ["de", "es", "en"] as const) {
    const cuerpo = textoLargo(projectDocument(locale, completo.contact));
    assert.ok(
      cuerpo.includes(maskContact(completo.contact)),
      `${locale}: el contacto va enmascarado`,
    );
    assert.equal(
      cuerpo.includes(completo.contact),
      false,
      `${locale}: la dirección con @ no puede aparecer en el HTML`,
    );
  }
  // Sin contacto configurado se remite al repositorio en vez de dejar el hueco.
  assert.match(textoLargo(projectDocument("es", "")), /abre una incidencia en el repositorio/);
});

test("el contacto del proyecto enlaza las incidencias y no el repositorio", () => {
  // Quien llega a «Contacto» quiere proponer algo o avisar de un fallo: la
  // página lo lleva a la lista de incidencias, no a la portada del código.
  for (const locale of ["de", "es", "en"] as const) {
    const enlaces = projectDocument(locale, completo.contact).sections.flatMap((seccion) =>
      seccion.blocks.flatMap((bloque) => (bloque.kind === "links" ? bloque.items : [])),
    );
    const incidencias = enlaces.find((enlace) => enlace.label === "Issues");
    assert.ok(incidencias, `${locale}: falta el enlace a las incidencias`);
    assert.equal(incidencias.href, "https://github.com/gallardoalba/WB/issues");
    assert.ok(
      !enlaces.some((enlace) => enlace.label === "Repository" || enlace.label === "Repositorio"),
      `${locale}: el rótulo del repositorio no puede volver`,
    );
  }
});
