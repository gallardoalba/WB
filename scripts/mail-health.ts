/**
 * ¿Puede este servidor entregar correo que llegue a la bandeja de entrada?
 *
 *   npm run mail:health            → informe legible (SPF, DKIM, DMARC y cola)
 *   npm run mail:health -- --json  → el mismo informe en JSON, para el vigilante
 *
 * Un correo que el proveedor acepta y el buzón manda a spam no aparece en
 * ningún contador: la base lo da por entregado y la persona nunca ve el enlace.
 * Este script mira lo que sí se puede comprobar desde el servidor: los tres
 * registros DNS que hacen que un buzón confíe en el dominio y el estado real de
 * la cola.
 *
 * Sale 1 si hay algo que arreglar, para poder encadenarlo en el mantenimiento o
 * llamarlo desde el vigilante. Sin `MAIL_FROM` no hay dominio que comprobar: se
 * informa y se sale 0, porque una instalación sin correo no está rota.
 */
import { resolveTxt } from "node:dns/promises";

import {
  formatHealth,
  mailProblems,
  parseDkim,
  parseDmarc,
  parseSpf,
  senderDomain,
  type MailHealth,
  type TxtRecords,
} from "../src/lib/mail-health";
import { outboxStats } from "../src/lib/outbox";

/** Una consulta DNS que falla es «no hay registro»: NXDOMAIN y caída se ven igual. */
async function txt(name: string): Promise<TxtRecords> {
  try {
    return await resolveTxt(name);
  } catch {
    return [];
  }
}

async function collect(domain: string): Promise<MailHealth> {
  const selector = process.env.MAIL_DKIM_SELECTOR?.trim() || null;
  const [spfRecords, dmarcRecords, dkimRecords] = await Promise.all([
    txt(domain),
    txt(`_dmarc.${domain}`),
    selector ? txt(`${selector}._domainkey.${domain}`) : Promise.resolve([]),
  ]);

  const base = {
    domain,
    spf: parseSpf(spfRecords),
    dmarc: parseDmarc(dmarcRecords),
    dkim: parseDkim(dkimRecords, selector),
    queue: outboxStats(),
  };
  return { ...base, problems: mailProblems(base) };
}

async function main(): Promise<void> {
  const domain = senderDomain(process.env.MAIL_FROM);
  const json = process.argv.includes("--json");

  if (!domain) {
    const mensaje =
      "MAIL_FROM no está definido o no lleva un dominio: no hay remitente que comprobar.";
    console.log(json ? JSON.stringify({ domain: null, problems: [] }) : mensaje);
    return;
  }

  const health = await collect(domain);
  console.log(json ? JSON.stringify(health, null, 2) : formatHealth(health));
  if (health.problems.length > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("mail-health.ts")) {
  void main();
}
