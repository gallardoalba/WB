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

const completo: LegalConfig = {
  controller: "Ada Lovelace",
  address: "Calle Mayor 1, 04109 Leipzig",
  contact: "hola@wanderbibliothek.org",
  vatId: "DE123456789",
  phone: "+49 341 000000",
  register: "Vereinsregister 42",
  complete: true,
};

const incompleto: LegalConfig = {
  controller: "",
  address: "",
  contact: "",
  vatId: "",
  phone: "",
  register: "",
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

  // Un contacto en blanco no cuenta como contacto.
  const sinContacto = legalConfig({
    LEGAL_CONTROLLER: "Ada",
    LEGAL_ADDRESS: "Calle Mayor 1",
    LEGAL_CONTACT_EMAIL: "   ",
  });
  assert.equal(sinContacto.complete, false);
});

test("la dirección de contacto se publica enmascarada", () => {
  // El aviso legal tiene que dar un medio de contacto, pero no regalárselo a
  // los rastreadores de correo: en el texto va `nombre[at]dominio`.
  assert.equal(maskContact("gallardoalba@pm.me"), "gallardoalba[at]pm.me");
  assert.equal(maskContact("  hola@wanderbibliothek.org  "), "hola[at]wanderbibliothek.org");
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
