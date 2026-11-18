/**
 * Los registros que hacen que un buzón confíe en el dominio.
 *
 * SPF, DKIM y DMARC no se pueden probar enviando un correo: el proveedor lo
 * acepta y el buzón decide después. Lo que sí se puede fijar es la lectura de
 * los registros y, sobre todo, qué se considera un problema: un SPF con `+all`,
 * un DMARC en `p=none` o un selector DKIM sin clave dejan el dominio a merced
 * de quien quiera enviar en su nombre.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatHealth,
  mailProblems,
  parseDkim,
  parseDmarc,
  parseSpf,
  senderDomain,
  type MailHealth,
} from "../src/lib/mail-health.ts";

/** Un TXT largo llega partido en trozos; la comprobación es la misma. */
const txt = (...chunks: string[]) => [chunks];

const COLA_SANA = { pending: 0, failed24h: 0, overdueMinutes: 0, lastError: null };

function sano(): Omit<MailHealth, "problems"> {
  return {
    domain: "biblioteca.example",
    spf: parseSpf(txt("v=spf1 include:_spf.brevo.com -all")),
    dmarc: parseDmarc(txt("v=DMARC1; p=quarantine; rua=mailto:dmarc@biblioteca.example")),
    dkim: parseDkim(txt("v=DKIM1; k=rsa; p=MIIBIjANBg"), "brevo"),
    queue: COLA_SANA,
  };
}

test("un SPF partido en trozos se lee como uno solo", () => {
  const spf = parseSpf(txt("v=spf1 include:_spf.brevo.com ", "-all"));
  assert.equal(spf.present, true);
  assert.equal(spf.allowsAll, false);
  assert.match(spf.record ?? "", /include:_spf\.brevo\.com -all/);
});

test("un SPF con +all o ?all se denuncia", () => {
  assert.equal(parseSpf(txt("v=spf1 +all")).allowsAll, true);
  assert.equal(parseSpf(txt("v=spf1 ?all")).allowsAll, true);
  // `~all` y `-all` son las formas razonables.
  assert.equal(parseSpf(txt("v=spf1 ~all")).allowsAll, false);
});

test("DMARC se reconoce por su versión y se lee la política", () => {
  assert.equal(parseDmarc(txt("v=DMARC1; p=reject")).policy, "reject");
  assert.equal(parseDmarc(txt("v=DMARC1; p=none; rua=mailto:x@y")).policy, "none");
  const sinPolitica = parseDmarc(txt("v=DMARC1; rua=mailto:x@y"));
  assert.equal(sinPolitica.present, true);
  assert.equal(sinPolitica.policy, null);
});

test("DKIM necesita selector: sin él no hay nada que consultar", () => {
  assert.deepEqual(parseDkim([], null), { selector: null, present: false });
  assert.equal(parseDkim(txt("v=DKIM1; k=rsa; p=ABC"), "brevo").present, true);
  assert.equal(parseDkim(txt("v=spf1 -all"), "brevo").present, false);
});

test("el dominio del remitente sale tanto de «correo@dominio» como de «Nombre <…>»", () => {
  assert.equal(senderDomain("no-reply@biblioteca.example"), "biblioteca.example");
  assert.equal(
    senderDomain("Wanderbibliothek <no-reply@Biblioteca.Example>"),
    "biblioteca.example",
  );
  assert.equal(senderDomain("sin arroba"), null);
  assert.equal(senderDomain(undefined), null);
  assert.equal(senderDomain("correo@localhost"), null, "un dominio sin punto no es un dominio");
});

test("un dominio bien configurado no tiene problemas", () => {
  assert.deepEqual(mailProblems(sano()), []);
});

test("lo que deja el dominio en manos de cualquiera se enumera", () => {
  const problemas = mailProblems({
    ...sano(),
    spf: parseSpf(txt("v=spf1 +all")),
    dmarc: parseDmarc(txt("v=DMARC1; p=none")),
    dkim: parseDkim([], "brevo"),
  });

  assert.deepEqual(problemas, [
    "el SPF termina en «+all»: autoriza a cualquiera a enviar en nombre del dominio",
    "DMARC está en «p=none»: se observa el fallo, no se protege el dominio",
    "no se encuentra la clave DKIM en brevo._domainkey.biblioteca.example",
  ]);
});

test("sin registros se dice cuáles faltan, con el nombre que hay que crear", () => {
  const problemas = mailProblems({
    ...sano(),
    spf: parseSpf([]),
    dmarc: parseDmarc([]),
    dkim: parseDkim([], null),
  });
  assert.deepEqual(problemas, [
    "no hay registro SPF en biblioteca.example: casi ningún buzón confiará en estos envíos",
    "no hay registro DMARC en _dmarc.biblioteca.example",
    "MAIL_DKIM_SELECTOR no está definido: no se puede comprobar la firma del proveedor",
  ]);
});

test("una cola parada es tan problema como un DNS mal puesto", () => {
  const problemas = mailProblems({
    ...sano(),
    queue: { pending: 4, failed24h: 2, overdueMinutes: 300, lastError: "sin respuesta" },
  });
  assert.deepEqual(problemas, [
    "2 correo(s) dados por perdidos en 24 h (último error: sin respuesta)",
    "hay correo con 300 min de retraso: el envío no avanza",
  ]);
});

test("el informe escrito dice el estado y qué arreglar", () => {
  const health: MailHealth = { ...sano(), problems: ["no hay registro DMARC en _dmarc.x"] };
  const texto = formatHealth(health);
  assert.match(texto, /Dominio: biblioteca\.example/);
  assert.match(texto, /DMARC: sí \(p=quarantine\)/);
  assert.match(texto, /Hay que arreglar:/);
  assert.match(texto, /· no hay registro DMARC/);

  assert.match(formatHealth({ ...sano(), problems: [] }), /Todo en orden/);
});
