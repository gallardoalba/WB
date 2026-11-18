/**
 * ¿Se puede entregar correo con este dominio?
 *
 * Un enlace de verificación que cae en la carpeta de spam es indistinguible de
 * un servidor caído: la persona se registra, no recibe nada y se va. Ningún
 * panel de la aplicación lo dice, porque el proveedor acepta el mensaje y la
 * base lo marca como enviado. Lo único que se puede comprobar desde el propio
 * servidor son los tres registros DNS que hacen que un buzón confíe en el
 * remitente —SPF, DKIM y DMARC— y el estado de la cola.
 *
 * Aquí vive la parte pura (interpretar los TXT y decidir qué es un problema);
 * la consulta DNS la hace `scripts/mail-health.ts`, para que esto se pueda
 * probar sin red.
 */

export type TxtRecords = string[][];

export type SpfCheck = {
  present: boolean;
  record: string | null;
  /**
   * `+all` o `?all` dejan pasar a cualquiera: es peor que no tener SPF, porque
   * lo que llega sin autorizar sigue siendo válido.
   */
  allowsAll: boolean;
};

export type DmarcCheck = {
  present: boolean;
  policy: "none" | "quarantine" | "reject" | null;
  record: string | null;
};

export type DkimCheck = {
  selector: string | null;
  present: boolean;
};

export type MailQueue = {
  pending: number;
  failed24h: number;
  /** Minutos de retraso del correo más atrasado (0 si todo está al día). */
  overdueMinutes: number;
  lastError: string | null;
};

export type MailHealth = {
  domain: string;
  spf: SpfCheck;
  dmarc: DmarcCheck;
  dkim: DkimCheck;
  queue: MailQueue;
  /** Lo que hay que arreglar, en lenguaje de quien administra. */
  problems: string[];
};

/** Los TXT llegan partidos en trozos: así es como se guardan los registros largos. */
function flatten(records: TxtRecords): string[] {
  return records.map((chunks) => chunks.join("").trim()).filter((value) => value.length > 0);
}

export function parseSpf(records: TxtRecords): SpfCheck {
  const record = flatten(records).find((value) => /^v=spf1\b/i.test(value)) ?? null;
  return {
    present: record !== null,
    record,
    allowsAll: record !== null && /(^|\s)[+?]all\b/i.test(record),
  };
}

export function parseDmarc(records: TxtRecords): DmarcCheck {
  const record = flatten(records).find((value) => /^v=DMARC1\b/i.test(value)) ?? null;
  const policy = record ? /(^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(record)?.[2] : undefined;
  return {
    present: record !== null,
    policy: (policy?.toLowerCase() as DmarcCheck["policy"]) ?? null,
    record,
  };
}

export function parseDkim(records: TxtRecords, selector: string | null): DkimCheck {
  return {
    selector,
    present: selector !== null && flatten(records).some((value) => /v=DKIM1\b/i.test(value)),
  };
}

/**
 * El veredicto.
 *
 * Se pide lo mínimo para no acabar en spam y se avisa de lo que no bloquea:
 *
 * - sin SPF, sin DMARC o con `p=none` hay problema: la política es «no opinar»,
 *   y muchos buzones lo tratan como sospecha;
 * - un SPF con `+all` se denuncia aunque el registro exista;
 * - la cola importa igual: un correo que no sale no llega a ningún buzón.
 */
export function mailProblems(health: Omit<MailHealth, "problems">): string[] {
  const problems: string[] = [];

  if (!health.spf.present) {
    problems.push(`no hay registro SPF en ${health.domain}: casi ningún buzón confiará en estos envíos`);
  } else if (health.spf.allowsAll) {
    problems.push("el SPF termina en «+all»: autoriza a cualquiera a enviar en nombre del dominio");
  }

  if (!health.dmarc.present) {
    problems.push(`no hay registro DMARC en _dmarc.${health.domain}`);
  } else if (health.dmarc.policy === "none") {
    problems.push("DMARC está en «p=none»: se observa el fallo, no se protege el dominio");
  } else if (health.dmarc.policy === null) {
    problems.push("el registro DMARC no declara una política «p=» legible");
  }

  if (health.dkim.selector === null) {
    problems.push("MAIL_DKIM_SELECTOR no está definido: no se puede comprobar la firma del proveedor");
  } else if (!health.dkim.present) {
    problems.push(
      `no se encuentra la clave DKIM en ${health.dkim.selector}._domainkey.${health.domain}`,
    );
  }

  if (health.queue.failed24h > 0) {
    problems.push(
      `${health.queue.failed24h} correo(s) dados por perdidos en 24 h` +
        (health.queue.lastError ? ` (último error: ${health.queue.lastError})` : ""),
    );
  }
  if (health.queue.overdueMinutes > 120) {
    problems.push(
      `hay correo con ${health.queue.overdueMinutes} min de retraso: el envío no avanza`,
    );
  }

  return problems;
}

/** Dominio del remitente (`MAIL_FROM` admite «Nombre <correo@dominio>»). */
export function senderDomain(mailFrom: string | undefined): string | null {
  const value = (mailFrom ?? "").trim();
  const address = /<([^<>]+)>/.exec(value)?.[1] ?? value;
  const domain = address.split("@")[1]?.trim().toLowerCase();
  return domain && domain.includes(".") ? domain : null;
}

export function formatHealth(health: MailHealth): string {
  const si = (value: boolean) => (value ? "sí" : "no");
  const lines = [
    `Dominio: ${health.domain}`,
    `  SPF:   ${si(health.spf.present)}${health.spf.record ? ` — ${health.spf.record}` : ""}`,
    `  DKIM:  ${si(health.dkim.present)}${health.dkim.selector ? ` (selector ${health.dkim.selector})` : ""}`,
    `  DMARC: ${si(health.dmarc.present)}${health.dmarc.policy ? ` (p=${health.dmarc.policy})` : ""}`,
    `Cola: ${health.queue.pending} pendiente(s), ${health.queue.failed24h} perdido(s) en 24 h, ` +
      `el más atrasado lleva ${health.queue.overdueMinutes} min de retraso.`,
  ];

  if (health.problems.length === 0) {
    lines.push("", "Todo en orden.");
  } else {
    lines.push("", "Hay que arreglar:");
    for (const problem of health.problems) lines.push(`  · ${problem}`);
  }
  return lines.join("\n");
}
