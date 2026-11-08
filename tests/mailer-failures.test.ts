/**
 * Fallos de entrega de correo, con el detalle que hace falta para arreglarlos.
 *
 * Un «no se envió» sin motivo se investiga en el sitio equivocado: Brevo
 * responde 401 por una IP no autorizada o 400 por un remitente sin autenticar,
 * y el proveedor externo puede estar caído. Lo que se fija aquí es que ninguno
 * de esos casos se da por entregado y que el registro dice cuál es.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

type Env = Record<string, string | undefined>;
type Call = { url: string; init: RequestInit };

const CLAVES = ["BREVO_API_KEY", "MAIL_FROM", "MAIL_WEBHOOK_URL", "MAIL_WEBHOOK_TOKEN", "NODE_ENV"] as const;

async function conEntorno(patch: Env, run: () => Promise<void>): Promise<void> {
  const env = process.env as Env;
  const previo = Object.fromEntries(CLAVES.map((clave) => [clave, env[clave]]));
  for (const clave of CLAVES) delete env[clave];
  for (const [clave, valor] of Object.entries(patch)) {
    if (valor !== undefined) env[clave] = valor;
  }
  try {
    await run();
  } finally {
    for (const clave of CLAVES) {
      const valor = previo[clave];
      if (valor === undefined) delete env[clave];
      else env[clave] = valor;
    }
  }
}

/** `fetch` falso: puede responder o lanzar, y deja ver cuántas veces se llamó. */
async function conFetch(
  responder: () => Response | never,
  run: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return responder();
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Captura lo que el correo escribe en el registro, sin ensuciar la salida. */
async function conRegistro(run: () => Promise<void>): Promise<string> {
  const lineas: string[] = [];
  const errores = console.error;
  const avisos = console.info;
  console.error = (...args: unknown[]) => lineas.push(args.map(String).join(" "));
  console.info = (...args: unknown[]) => lineas.push(args.map(String).join(" "));
  try {
    await run();
  } finally {
    console.error = errores;
    console.info = avisos;
  }
  return lineas.join("\n");
}

const CORREO = { to: "lectora@example.test", subject: "Alta", text: "cuerpo-confidencial" };

test("un rechazo de Brevo sin JSON deja el código y el aviso de IP", async () => {
  const { sendMail } = await import("../src/lib/mailer.ts");
  let entregado = true;
  const registro = await conRegistro(async () => {
    await conEntorno(
      { BREVO_API_KEY: "xkeysib-prueba", MAIL_FROM: "no-reply@biblioteca.example", NODE_ENV: "production" },
      async () => {
        await conFetch(
          () => new Response("<html>gateway</html>", { status: 403 }),
          async () => {
            entregado = (await sendMail(CORREO)).delivered;
          },
        );
      },
    );
  });

  assert.equal(entregado, false);
  assert.match(registro, /Brevo rechazó el envío 403/);
  assert.match(registro, /sin detalle/, "sin JSON legible se dice que no hay detalle");
  assert.match(registro, /IP autorizadas/);
  assert.doesNotMatch(registro, /cuerpo-confidencial/);
});

test("un 400 de Brevo apunta al remitente o al dominio", async () => {
  const { sendMail } = await import("../src/lib/mailer.ts");
  const registro = await conRegistro(async () => {
    await conEntorno(
      { BREVO_API_KEY: "xkeysib-prueba", MAIL_FROM: "no-reply@biblioteca.example", NODE_ENV: "production" },
      async () => {
        await conFetch(
          () =>
            new Response(JSON.stringify({ code: "invalid_parameter", message: "sender not valid" }), {
              status: 400,
            }),
          async () => {
            assert.equal((await sendMail(CORREO)).delivered, false);
          },
        );
      },
    );
  });

  assert.match(registro, /invalid_parameter/);
  assert.match(registro, /sender not valid/);
  assert.match(registro, /sin autenticar/);
});

test("si no se puede hablar con Brevo, el mensaje no se da por enviado", async () => {
  const { sendMail } = await import("../src/lib/mailer.ts");
  const registro = await conRegistro(async () => {
    await conEntorno(
      { BREVO_API_KEY: "xkeysib-prueba", MAIL_FROM: "no-reply@biblioteca.example", NODE_ENV: "production" },
      async () => {
        await conFetch(
          () => {
            throw new Error("ECONNRESET");
          },
          async () => {
            assert.equal((await sendMail(CORREO)).delivered, false);
          },
        );
      },
    );
  });

  assert.match(registro, /no se pudo contactar con Brevo/);
  assert.match(registro, /sigue en la cola/);
});

test("un webhook que responde error deja el estado en el registro", async () => {
  const { sendMail } = await import("../src/lib/mailer.ts");
  const registro = await conRegistro(async () => {
    await conEntorno({ MAIL_WEBHOOK_URL: "https://mail.example/send", NODE_ENV: "production" }, async () => {
      await conFetch(
        () => new Response("{}", { status: 502 }),
        async () => {
          assert.equal((await sendMail(CORREO)).delivered, false);
        },
      );
    });
  });

  assert.match(registro, /el proveedor respondió 502/);
});

test("sin proveedor, en producción el fallo es explícito y no vuelca el cuerpo", async () => {
  const { sendMail } = await import("../src/lib/mailer.ts");
  let entregado = true;
  const registro = await conRegistro(async () => {
    await conEntorno({ NODE_ENV: "production" }, async () => {
      await conFetch(
        () => {
          throw new Error("no debería llamarse a ningún proveedor");
        },
        async (calls) => {
          entregado = (await sendMail(CORREO)).delivered;
          assert.equal(calls.length, 0);
        },
      );
    });
  });

  assert.equal(entregado, false);
  assert.match(registro, /sin proveedor de correo configurado/);
  assert.doesNotMatch(registro, /cuerpo-confidencial/, "en producción nunca se vuelca el cuerpo");
});
