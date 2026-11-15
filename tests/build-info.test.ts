import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { readBuildInfo, shortCommit } from "../src/lib/build-info.ts";

/**
 * Identidad del despliegue.
 *
 * El valor que publica `/api/version` solo sirve si es exacto: un commit
 * inventado o una fecha ilegible convierten la comprobación en teatro. Estos
 * casos fijan qué se acepta, qué se descarta y de dónde se lee.
 */

const SHA = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;

const DIRS: string[] = [];

function buildDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-build-"));
  DIRS.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test("un entorno completo se publica tal cual, con el enlace al commit", () => {
  const info = readBuildInfo(
    {
      APP_COMMIT_SHA: SHA.toUpperCase(),
      APP_IMAGE_DIGEST: DIGEST,
      APP_BUILD_TIME: "2026-11-15T10:20:30Z",
    },
    buildDir(),
  );

  assert.equal(info.commit, SHA);
  assert.equal(info.commitUrl, `https://github.com/gallardoalba/WB/commit/${SHA}`);
  assert.equal(info.image, DIGEST);
  assert.equal(info.builtAt, "2026-11-15T10:20:30.000Z");
});

test("un valor con forma rara se descarta en vez de publicarse", () => {
  const info = readBuildInfo(
    {
      APP_COMMIT_SHA: "main; rm -rf /",
      APP_IMAGE_DIGEST: "sha256:corto",
      APP_BUILD_TIME: "ayer por la tarde",
    },
    buildDir(),
  );

  assert.deepEqual(info, { commit: null, commitUrl: null, image: null, builtAt: null });
});

test("el digest también se lee de la referencia de la imagen", () => {
  assert.equal(
    readBuildInfo({ APP_IMAGE: `ghcr.io/gallardoalba/wb@${DIGEST}` }, buildDir()).image,
    DIGEST,
  );
  // Una referencia sin digest (o con basura detrás de la arroba) no publica
  // nada: mejor decir «no lo sé» que un valor a medias.
  assert.equal(readBuildInfo({ APP_IMAGE: "ghcr.io/gallardoalba/wb:latest" }, buildDir()).image, null);
  assert.equal(
    readBuildInfo({ APP_IMAGE: `ghcr.io/x@${DIGEST}`, APP_IMAGE_DIGEST: DIGEST }, buildDir()).image,
    DIGEST,
  );
});

test("sin entorno se usa lo que dejó el despliegue por systemd", () => {
  const dir = buildDir({
    ".build-info.json": JSON.stringify({
      commit: SHA,
      builtAt: "2026-11-14T08:00:00Z",
    }),
  });
  const info = readBuildInfo({}, dir);

  assert.equal(info.commit, SHA);
  assert.equal(info.builtAt, "2026-11-14T08:00:00.000Z");
  assert.equal(info.image, null);
});

test("el entorno manda sobre el fichero y un fichero roto no rompe el arranque", () => {
  const dir = buildDir({ ".build-info.json": "{ esto no es json" });
  assert.equal(readBuildInfo({ APP_COMMIT_SHA: SHA }, dir).commit, SHA);
  assert.equal(readBuildInfo({}, dir).commit, null);

  const nullDir = buildDir({ ".build-info.json": "null" });
  assert.equal(readBuildInfo({}, nullDir).commit, null);

  const alias = buildDir({ ".build-info.json": JSON.stringify({ commit: "no-es-un-sha" }) });
  assert.equal(readBuildInfo({}, alias).commit, null);
});

test("el commit se abrevia como en `git log --oneline`", () => {
  assert.equal(shortCommit(SHA), "aaaaaaa");
  assert.equal(shortCommit("abc1234"), "abc1234");
});

after(() => {
  for (const dir of DIRS) rmSync(dir, { recursive: true, force: true });
});
