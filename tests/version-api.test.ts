import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { GET } from "../src/app/api/version/route.ts";

/**
 * Contrato público de `/api/version`.
 *
 * Es lo primero que consulta quien quiere comprobar un despliegue: si devuelve
 * un commit inventado o un enlace roto, la comprobación entera deja de valer.
 */

const SHA = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;
const saved = { ...process.env };

afterEach(() => {
  for (const key of ["APP_COMMIT_SHA", "APP_IMAGE", "APP_BUILD_TIME"] as const) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("con identidad conocida publica commit, imagen y enlace al árbol", async () => {
  process.env.APP_COMMIT_SHA = SHA;
  process.env.APP_IMAGE = `ghcr.io/gallardoalba/wb@${DIGEST}`;
  process.env.APP_BUILD_TIME = "2026-11-15T10:20:30Z";

  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");

  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.commit, SHA);
  assert.equal(body.commitUrl, `https://github.com/gallardoalba/WB/commit/${SHA}`);
  assert.equal(body.sourceUrl, `https://github.com/gallardoalba/WB/tree/${SHA}`);
  assert.equal(body.image, DIGEST);
  assert.equal(body.builtAt, "2026-11-15T10:20:30.000Z");
  assert.equal(body.repository, "https://github.com/gallardoalba/WB");
});

test("sin identidad no se inventa un commit", async () => {
  delete process.env.APP_COMMIT_SHA;
  delete process.env.APP_IMAGE;
  delete process.env.APP_BUILD_TIME;

  const response = await GET();
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.commit, null);
  assert.equal(body.commitUrl, null);
  assert.equal(body.sourceUrl, null);
  assert.equal(body.image, null);
  assert.equal(body.builtAt, null);
});

test("una identidad con forma inválida se descarta", async () => {
  process.env.APP_COMMIT_SHA = "no-es-un-commit";
  process.env.APP_IMAGE = "latest";
  process.env.APP_BUILD_TIME = "ayer";

  const body = (await (await GET()).json()) as Record<string, unknown>;
  assert.equal(body.commit, null);
  assert.equal(body.image, null);
  assert.equal(body.builtAt, null);
});
