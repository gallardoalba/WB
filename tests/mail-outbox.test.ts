/**
 * Bandeja de salida del correo (`mail_outbox`).
 *
 * Los enlaces de verificación y restablecimiento no se envían «a la primera»:
 * se encolan y un worker los reintenta con espera creciente. Lo que se fija
 * aquí:
 *
 * - un correo nuevo queda pendiente y se entrega en la siguiente pasada,
 * - un fallo no se pierde: suma un intento y programa el siguiente con espera,
 * - al quinto fallo se marca como fallido y no se vuelve a intentar,
 * - la limpieza borra lo entregado o fallido antiguo y nunca lo pendiente.
 */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type OutboxModule = typeof import("../src/lib/outbox.ts");
type DbModule = typeof import("../src/lib/db/index.ts");

let outbox: OutboxModule;
let dbModule: DbModule;

const CORREO = { to: "lectora@example.test", subject: "Confirma tu correo", text: "https://x/verificar#t" };

type Call = { url: string; init: RequestInit };

/** Sustituye `fetch` durante la prueba y devuelve las llamadas recibidas. */
async function conFetch<T>(responder: () => Response, run: (calls: Call[]) => Promise<T>): Promise<T> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return responder();
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Fija el proveedor de correo (y el entorno) y lo restaura al terminar. */
async function conEntorno(patch: Record<string, string | undefined>, run: () => Promise<void>) {
  const env = process.env as Record<string, string | undefined>;
  const claves = ["MAIL_WEBHOOK_URL", "MAIL_WEBHOOK_TOKEN", "BREVO_API_KEY", "MAIL_FROM", "NODE_ENV"];
  const previo = Object.fromEntries(claves.map((clave) => [clave, env[clave]]));
  for (const clave of claves) delete env[clave];
  for (const [clave, valor] of Object.entries(patch)) {
    if (valor !== undefined) env[clave] = valor;
  }
  try {
    await run();
  } finally {
    for (const clave of claves) {
      const valor = previo[clave];
      if (valor === undefined) delete env[clave];
      else env[clave] = valor;
    }
  }
}

/** El worker registra los fallos; las pruebas no ensucian la salida. */
function silenciar(): () => void {
  const originales = { error: console.error, info: console.info, warn: console.warn };
  console.error = () => undefined;
  console.info = () => undefined;
  console.warn = () => undefined;
  return () => {
    console.error = originales.error;
    console.info = originales.info;
    console.warn = originales.warn;
  };
}

function db() {
  return dbModule.getDb();
}

function fila(id: string) {
  return db()
    .prepare(
      "SELECT id, to_email, subject, body, status, attempts, next_attempt_at, last_error, sent_at FROM mail_outbox WHERE id = ?",
    )
    .get(id) as
    | {
        id: string;
        to_email: string;
        subject: string;
        body: string;
        status: string;
        attempts: number;
        next_attempt_at: string;
        last_error: string | null;
        sent_at: string | null;
      }
    | undefined;
}

/** Inserta una fila con control del estado y de la antigüedad. */
function insertar(id: string, status: string, attempts: number, antiguedad = "-1 minutes") {
  db()
    .prepare(
      `INSERT INTO mail_outbox (id, to_email, subject, body, status, attempts, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               strftime('%Y-%m-%dT%H:%M:%fZ','now', ?))`,
    )
    .run(id, "lectora@example.test", "Asunto", "Cuerpo", status, attempts, antiguedad);
}

let restaurarSalida: () => void = () => undefined;

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  outbox = await import("../src/lib/outbox.ts");
});

beforeEach(() => {
  db().prepare("DELETE FROM mail_outbox").run();
  restaurarSalida = silenciar();
});

afterEach(() => {
  restaurarSalida();
});

test("un correo nuevo queda pendiente y sin intentos", () => {
  const id = outbox.enqueueMail(CORREO);
  assert.match(id, /^mail_[0-9a-f-]{36}$/);

  const guardado = fila(id);
  assert.ok(guardado);
  assert.equal(guardado.to_email, CORREO.to);
  assert.equal(guardado.subject, CORREO.subject);
  assert.equal(guardado.body, CORREO.text);
  assert.equal(guardado.status, "pending");
  assert.equal(guardado.attempts, 0);
  assert.equal(guardado.sent_at, null);
  assert.equal(guardado.last_error, null);
  // Se puede intentar ya: la primera pasada no espera.
  assert.ok(guardado.next_attempt_at);
});

test("la pasada entrega lo pendiente y lo marca como enviado", async () => {
  const id = outbox.enqueueMail(CORREO);

  await conEntorno({ MAIL_WEBHOOK_URL: "https://mail.example/send", NODE_ENV: "production" }, async () => {
    await conFetch(
      () => new Response("{}", { status: 200 }),
      async (calls) => {
        const result = await outbox.processOutbox();
        assert.deepEqual(result, { sent: 1, failed: 0 });
        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.url, "https://mail.example/send");
        assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
          to: CORREO.to,
          subject: CORREO.subject,
          text: CORREO.text,
        });
      },
    );
  });

  const guardado = fila(id);
  assert.ok(guardado);
  assert.equal(guardado.status, "sent");
  assert.ok(guardado.sent_at, "sin fecha de envío no se puede limpiar después");
  assert.equal(guardado.last_error, null);
});

test("un fallo suma un intento y espera antes de reintentar", async () => {
  const id = outbox.enqueueMail(CORREO);

  await conEntorno({ MAIL_WEBHOOK_URL: "https://mail.example/send", NODE_ENV: "production" }, async () => {
    await conFetch(
      () => new Response("{}", { status: 500 }),
      async (calls) => {
        const result = await outbox.processOutbox();
        assert.deepEqual(result, { sent: 0, failed: 1 });

        const guardado = fila(id);
        assert.ok(guardado);
        assert.equal(guardado.status, "pending");
        assert.equal(guardado.attempts, 1);
        assert.match(guardado.last_error ?? "", /no confirmó la entrega/);
        // La espera crece con los intentos: el primero deja un minuto y medio.
        const espera = db()
          .prepare(
            "SELECT next_attempt_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','+60 seconds') AS dentro FROM mail_outbox WHERE id = ?",
          )
          .get(id) as { dentro: number };
        assert.equal(espera.dentro, 1, "el siguiente intento queda programado con espera");

        // Una segunda pasada inmediata no vuelve a intentarlo: aún no toca.
        const otra = await outbox.processOutbox();
        assert.deepEqual(otra, { sent: 0, failed: 0 });
        assert.equal(calls.length, 1);
      },
    );
  });
});

test("al quinto fallo el correo se da por perdido y no se reintenta", async () => {
  // Cuatro intentos previos: el siguiente es el último.
  insertar("mail_casi", "pending", 4);

  await conEntorno({ MAIL_WEBHOOK_URL: "https://mail.example/send", NODE_ENV: "production" }, async () => {
    await conFetch(
      () => new Response("{}", { status: 503 }),
      async () => {
        assert.deepEqual(await outbox.processOutbox(), { sent: 0, failed: 1 });
      },
    );
  });

  const guardado = fila("mail_casi");
  assert.ok(guardado);
  assert.equal(guardado.attempts, 5);
  assert.equal(guardado.status, "failed");

  // Ya no entra en ninguna pasada, aunque su fecha ya haya pasado.
  await conEntorno({ MAIL_WEBHOOK_URL: "https://mail.example/send", NODE_ENV: "production" }, async () => {
    await conFetch(
      () => new Response("{}", { status: 200 }),
      async (calls) => {
        assert.deepEqual(await outbox.processOutbox(), { sent: 0, failed: 0 });
        assert.equal(calls.length, 0);
      },
    );
  });
});

test("la pasada respeta el límite y atiende primero lo más antiguo", async () => {
  insertar("mail_viejo", "pending", 0, "-10 minutes");
  insertar("mail_medio", "pending", 0, "-5 minutes");
  insertar("mail_nuevo", "pending", 0, "-1 minutes");

  await conEntorno({ MAIL_WEBHOOK_URL: "https://mail.example/send", NODE_ENV: "production" }, async () => {
    await conFetch(
      () => new Response("{}", { status: 200 }),
      async () => {
        assert.deepEqual(await outbox.processOutbox(2), { sent: 2, failed: 0 });
      },
    );
  });

  assert.equal(fila("mail_viejo")?.status, "sent");
  assert.equal(fila("mail_medio")?.status, "sent");
  assert.equal(fila("mail_nuevo")?.status, "pending", "el límite deja trabajo para la siguiente pasada");
});

test("la limpieza borra lo antiguo entregado o fallido, nunca lo pendiente", () => {
  insertar("mail_enviado", "sent", 0, "-30 days");
  insertar("mail_fallido", "failed", 5, "-30 days");
  insertar("mail_pendiente", "pending", 0, "-30 days");
  insertar("mail_reciente", "sent", 0, "-1 days");

  assert.equal(outbox.purgeOutbox(7), 2);
  assert.equal(fila("mail_enviado"), undefined);
  assert.equal(fila("mail_fallido"), undefined);
  assert.ok(fila("mail_pendiente"), "un pendiente antiguo sigue siendo trabajo por hacer");
  assert.ok(fila("mail_reciente"), "lo reciente se conserva para poder investigar");
});
