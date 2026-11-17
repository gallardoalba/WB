/**
 * Política de la auditoría de dependencias de desarrollo.
 *
 * Lo que se fija aquí es la frontera entre «este PR no puede entrar» y «queda
 * anotado»: bloquea solo un aviso alto o crítico que se corrija sin romper la
 * API, porque es lo único que alguien puede resolver en el propio cambio. El
 * caso real que lo motivó es `picomatch`/CVE-2026-112366, sin versión corregida
 * publicada: antes, un `npm audit` a secas dejaba la integración en rojo por un
 * aviso que nadie podía tocar.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDevAudit, reviewDevAudit, type NpmAuditReport } from "../scripts/audit-dev.ts";

const advisory = {
  name: "paquete-x",
  title: "Fallo de ejemplo",
  url: "https://github.com/advisories/GHSA-0000-0000-0000",
  severity: "high",
};

function report(vulnerabilities: NpmAuditReport["vulnerabilities"], counts = { high: 1 }): NpmAuditReport {
  return { vulnerabilities, metadata: { vulnerabilities: counts } };
}

test("un aviso alto con versión corregida bloquea", () => {
  const findings = reviewDevAudit(
    report({
      "paquete-x": { severity: "high", via: [advisory], fixAvailable: true },
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].blocking, true);
  assert.match(findings[0].fix.text, /hay versión corregida/);
});

test("un aviso alto sin corrección se informa pero no bloquea", () => {
  const findings = reviewDevAudit(
    report({
      "paquete-x": { severity: "high", via: [advisory], fixAvailable: false },
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].blocking, false);
  assert.match(findings[0].fix.text, /sin versión corregida/);
});

test("una corrección que exige un cambio mayor no bloquea el cambio", () => {
  const findings = reviewDevAudit(
    report({
      "paquete-x": {
        severity: "critical",
        via: [{ ...advisory, severity: "critical" }],
        fixAvailable: { name: "paquete-padre", version: "1.0.0", isSemVerMajor: true },
      },
    }),
  );

  assert.equal(findings[0].blocking, false);
  assert.match(findings[0].fix.text, /paquete-padre a 1\.0\.0 \(cambio mayor\)/);
});

test("moderados y bajos no aparecen: la política corta en alto", () => {
  const findings = reviewDevAudit(
    report({
      "paquete-x": { severity: "moderate", via: [{ ...advisory, severity: "moderate" }], fixAvailable: true },
      "paquete-y": { severity: "low", via: [{ ...advisory, name: "paquete-y", severity: "low" }], fixAvailable: true },
    }),
  );

  assert.deepEqual(findings, []);
});

test("los eslabones de la cadena no duplican el aviso", () => {
  // `npm audit` repite el mismo aviso en cada paquete que arrastra la
  // dependencia; el informe debe enseñarlo una sola vez.
  const findings = reviewDevAudit(
    report({
      picomatch: { severity: "high", via: [advisory], fixAvailable: false },
      fdir: { severity: "high", via: ["picomatch"], fixAvailable: false },
      tinyglobby: { severity: "high", via: ["fdir"], fixAvailable: false },
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].package, "paquete-x");
});

test("el informe dice qué bloquea y qué solo se anota", () => {
  const findings = reviewDevAudit(
    report({
      "paquete-x": { severity: "high", via: [advisory], fixAvailable: true },
      "paquete-y": {
        severity: "high",
        via: [{ ...advisory, name: "paquete-y", title: "Otro fallo", url: "https://example.test/2" }],
        fixAvailable: false,
      },
    }),
  );
  const text = formatDevAudit(findings, { high: 2 });

  assert.match(text, /Dependencias de desarrollo: 2 high/);
  assert.match(text, /BLOQUEA · hay versión corregida/);
  assert.match(text, /informa · sin versión corregida publicada/);
  assert.match(text, /1 aviso\(s\) se pueden corregir/);
});
