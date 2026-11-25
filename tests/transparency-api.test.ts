import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type Route = (request: Request) => Promise<Response>;

let index: Route;
let exportRoute: Route;
let db: import("../src/lib/db/index.ts").Db;
let lib: typeof import("../src/lib/transparency.ts");

const LINES = ['{"id":"uno","title":"Uno"}', '{"id":"dos","title":"Dos"}'];

before(async () => {
  db = (await import("../src/lib/db/index.ts")).getDb();
  lib = await import("../src/lib/transparency.ts");
  index = (await import("../src/app/api/transparency/route.ts")).GET;
  exportRoute = (await import("../src/app/api/transparency/export/route.ts")).GET;
});

const get = (path: string) => new Request(`http://localhost:3000${path}`);

test("sin instantáneas, el índice lo dice y la descarga no inventa contenido", async () => {
  const empty = await index(get("/api/transparency"));
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), {
    latest: null,
    snapshots: [],
    payloadRetentionDays: 400,
  });

  const missing = await exportRoute(get("/api/transparency/export"));
  assert.equal(missing.status, 404);
});

test("el índice publica raíz y firma, nunca el contenido", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const key = lib.signingKey(privateKey.export({ format: "pem", type: "pkcs8" }).toString())!;
  const snapshot = lib.createSnapshot(db, {
    now: "2026-11-15T09:00:00.000Z",
    key,
    lines: LINES,
  });

  const response = await index(get("/api/transparency"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");

  const body = (await response.json()) as {
    latest: Record<string, unknown>;
    snapshots: Record<string, unknown>[];
    payloadRetentionDays: number;
  };
  assert.equal(body.latest.id, snapshot.id);
  assert.equal(body.latest.merkleRoot, snapshot.merkleRoot);
  assert.equal(body.latest.signature, snapshot.signature);
  assert.equal(body.snapshots.length, 1);
  // El contenido no viaja en el índice: se descarga aparte y así su hash es
  // comprobable byte a byte.
  assert.equal("payload" in body.latest, false);
  assert.equal(JSON.stringify(body).includes("Uno"), false);
});

test("la descarga sirve el NDJSON exacto y anuncia sus hashes", async () => {
  const latest = lib.latestSnapshot(db)!;
  const response = await exportRoute(get("/api/transparency/export"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.equal(response.headers.get("x-snapshot-id"), latest.id);
  assert.equal(response.headers.get("x-content-sha256"), latest.payloadHash);
  assert.equal(response.headers.get("x-merkle-root"), latest.merkleRoot);
  assert.equal(response.headers.get("x-item-count"), String(latest.itemCount));

  const body = await response.text();
  assert.equal(body, lib.payloadOf(LINES));
  assert.equal(lib.payloadHash(body), latest.payloadHash);
  assert.deepEqual(lib.verifySnapshot(latest, body), { ok: true, problems: [] });
});

test("se puede pedir una instantánea concreta por identificador", async () => {
  const older = lib.createSnapshot(db, {
    now: "2026-11-14T09:00:00.000Z",
    key: null,
    lines: ["{\"id\":\"viejo\"}"],
  });

  const response = await exportRoute(get(`/api/transparency/export?id=${older.id}`));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "{\"id\":\"viejo\"}\n");

  const unknown = await exportRoute(get("/api/transparency/export?id=snp_no_existe"));
  assert.equal(unknown.status, 404);
});

test("el contenido podado responde 410 y no rompe la cadena", async () => {
  const old = lib.createSnapshot(db, {
    now: "2024-01-01T00:00:00.000Z",
    key: null,
    lines: ["{\"id\":\"antiguo\"}"],
  });
  // Crear la siguiente dispara la poda por retención.
  lib.createSnapshot(db, { now: "2026-11-15T12:00:00.000Z", key: null, lines: LINES });

  const response = await exportRoute(
    get(`/api/transparency/export?id=${encodeURIComponent(old.id)}`),
  );
  assert.equal(response.status, 410);

  const indexBody = (await (await index(get("/api/transparency"))).json()) as {
    snapshots: { id: string }[];
  };
  assert.ok(indexBody.snapshots.some((snapshot) => snapshot.id === old.id));
});

test("la ruta de consistencia une dos instantáneas y rechaza lo que no es un id", async () => {
  const consistency = (await import("../src/app/api/transparency/keys/consistency/route.ts")).GET;
  const { privateKey } = generateKeyPairSync("ed25519");
  const key = lib.signingKey(privateKey.export({ format: "pem", type: "pkcs8" }).toString())!;

  const antes = lib.createKeySnapshot(db, {
    key,
    now: "2026-11-16T09:00:00.000Z",
    lines: ["cuenta|web|clave-1|2026-11-16"],
  });
  const despues = lib.createKeySnapshot(db, {
    key,
    now: "2026-11-17T09:00:00.000Z",
    lines: ["cuenta|web|clave-1|2026-11-16", "cuenta|web|clave-2|2026-11-17"],
  });

  const ok = await consistency(
    get(`/api/transparency/keys/consistency?from=${antes.id}&to=${despues.id}`),
  );
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as {
    from: { id: string; itemCount: number; merkleRoot: string };
    to: { id: string; itemCount: number; merkleRoot: string };
    proof: string[];
  };
  assert.equal(body.from.id, antes.id);
  assert.equal(body.to.id, despues.id);
  assert.ok(body.proof.length > 0, "hay prueba");

  const sinParametros = await consistency(get("/api/transparency/keys/consistency"));
  assert.equal(sinParametros.status, 400);

  const basura = await consistency(
    get("/api/transparency/keys/consistency?from=../etc/passwd&to=otra"),
  );
  assert.equal(basura.status, 422, "un id que no tiene forma de id no llega a la consulta");

  const inexistente = await consistency(
    get(
      `/api/transparency/keys/consistency?from=kys_00000000-0000-4000-8000-000000000000&to=${despues.id}`,
    ),
  );
  assert.equal(inexistente.status, 404);

  const iguales = await consistency(
    get(`/api/transparency/keys/consistency?from=${antes.id}&to=${antes.id}`),
  );
  assert.equal(iguales.status, 400);
});
