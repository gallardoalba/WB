import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type RepoModule = typeof import("../src/lib/repo.ts");

let repo: RepoModule;

before(async () => {
  repo = await import("../src/lib/repo.ts");
});

test("una incidencia de intercambio exige descripción y participantes", () => {
  assert.throws(
    () =>
      repo.reportContent({
        reporterId: "usr_ana",
        targetType: "request",
        targetId: "req_seed_1",
        reason: "El libro no llegó",
        details: "corto",
      }),
    (error: unknown) => error instanceof Error && error.message.includes("Describe"),
  );

  repo.reportContent({
    reporterId: "usr_ana",
    targetType: "request",
    targetId: "req_seed_1",
    reason: "El libro no llegó",
    details: "No llegó después de dos semanas y no hay respuesta.",
  });

  const incident = repo
    .listReports()
    .find((report) => report.targetType === "request");
  assert.ok(incident);
  assert.match(incident!.targetLabel, /Poeta chileno/);
  assert.equal(incident!.reason, "El libro no llegó");

  assert.throws(
    () =>
      repo.reportContent({
        reporterId: "usr_diego",
        targetType: "request",
        targetId: "req_seed_1",
        reason: "El libro no llegó",
        details: "No participo en este intercambio, pero intento denunciarlo.",
      }),
    (error: unknown) => error instanceof Error && error.message.includes("intercambio"),
  );
});

test("las métricas de producto incluyen el embudo de intercambios", () => {
  const metrics = repo.getCommunityMetrics();
  assert.ok(metrics.availableListings >= 0);
  assert.ok(metrics.requests30d >= 0);
  assert.ok(metrics.completed30d >= 0);
  assert.ok(metrics.activeUsers30d >= 0);
});
