import assert from "node:assert/strict";
import { test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type Env = Record<string, string | undefined>;
type Call = { url: string; init: RequestInit };

const CLAVES = ["BREVO_API_KEY", "MAIL_FROM", "MAIL_WEBHOOK_URL", "MAIL_WEBHOOK_TOKEN"] as const;

/** Sustituye `fetch` durante la prueba y devuelve las llamadas recibidas. */
async function conFetch<T>(
  responder: () => Response,
  run: (calls: Call[]) => Promise<T>,
): Promise<T> {
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

/** Deja el entorno de correo con solo lo indicado y lo restaura al terminar. */
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

/** Captura lo que va a `console.error` sin ensuciar la salida de las pruebas. */
async function conRegistro(run: () => Promise<void>): Promise<string> {
  const lineas: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lineas.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    await run();
  } finally {
    console.error = original;
  }
  return lineas.join("\n");
}

test("el remitente admite «Nombre <correo>» y también la dirección sola", async () => {
  const { parseSender } = await import("../src/lib/mailer.ts");
  assert.deepEqual(parseSender("Wanderbibliothek <no-reply@biblioteca.example>"), {
    email: "no-reply@biblioteca.example",
    name: "Wanderbibliothek",
  });
  assert.deepEqual(parseSender("  no-reply@biblioteca.example  "), {
    email: "no-reply@biblioteca.example",
  });
  // Las comillas son del formato del nombre, no del nombre.
  assert.deepEqual(parseSender('"Wander, Bibliothek" <hola@biblioteca.example>'), {
    email: "hola@biblioteca.example",
    name: "Wander, Bibliothek",
  });
  for (const roto of [undefined, "", "   ", "no-es-un-correo", "Nombre <sin-arroba>"]) {
    assert.equal(parseSender(roto), null, `«${roto}» debería rechazarse`);
  }
});

test("con Brevo, el envío va a su API con sender, to, subject y textContent", async () => {
  const { sendMail } = await import("../src/lib/mailer.ts");
  await conEntorno(
    { BREVO_API_KEY: "xkeysib-prueba", MAIL_FROM: "Wanderbibliothek <no-reply@biblioteca.example>" },
    async () => {
      await conFetch(
        () => new Response(JSON.stringify({ messageId: "<2017983@relay>" }), { status: 201 }),
        async (calls) => {
          const result = await sendMail({
            to: "lectora@example.test",
            subject: "Confirma tu cuenta",
            text: "https://biblioteca.example/verificar?token=abc",
          });
          assert.equal(result.delivered, true);
          assert.equal(calls.length, 1);
          assert.equal(calls[0]!.url, "https://api.brevo.com/v3/smtp/email");
          const headers = calls[0]!.init.headers as Record<string, string>;
          assert.equal(headers["api-key"], "xkeysib-prueba");
          // La clave viaja en la cabecera, nunca en el cuerpo.
          assert.doesNotMatch(String(calls[0]!.init.body), /xkeysib/);
          assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
            sender: { email: "no-reply@biblioteca.example", name: "Wanderbibliothek" },
            to: [{ email: "lectora@example.test" }],
            subject: "Confirma tu cuenta",
            textContent: "https://biblioteca.example/verificar?token=abc",
          });
        },
      );
    },
  );
});

test("un rechazo de Brevo se declara fallido y deja el motivo en el registro", async () => {
  const { sendMail } = await import("../src/lib/mailer.ts");
  const env = process.env as Env;
  const nodoPrevio = env.NODE_ENV;
  env.NODE_ENV = "production";
  let entregado = true;
  const registro = await conRegistro(async () => {
    try {
      await conEntorno(
        { BREVO_API_KEY: "xkeysib-prueba", MAIL_FROM: "no-reply@biblioteca.example" },
        async () => {
          await conFetch(
            () =>
              new Response(
                JSON.stringify({ code: "unauthorized", message: "IP address not authorised" }),
                { status: 401 },
              ),
            async () => {
              const result = await sendMail({
                to: "lectora@example.test",
                subject: "Alta",
                text: "cuerpo-confidencial",
              });
              entregado = result.delivered;
            },
          );
        },
      );
    } finally {
      if (nodoPrevio === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = nodoPrevio;
    }
  });

  // Sin entrega confirmada la cola reintenta: nunca se da por enviado.
  assert.equal(entregado, false);
  assert.match(registro, /Brevo rechazó el envío 401/);
  assert.match(registro, /unauthorized/);
  assert.match(registro, /IP autorizadas/);
  assert.match(registro, /sigue en la cola/);
  // El cuerpo lleva un token de un solo uso: no se vuelca en el registro.
  assert.doesNotMatch(registro, /cuerpo-confidencial/);
});

test("sin MAIL_FROM no se inventa un remitente: el envío queda pendiente", async () => {
  const { sendMail } = await import("../src/lib/mailer.ts");
  const env = process.env as Env;
  const nodoPrevio = env.NODE_ENV;
  env.NODE_ENV = "production";
  let entregado = true;
  const registro = await conRegistro(async () => {
    try {
      await conEntorno({ BREVO_API_KEY: "xkeysib-prueba" }, async () => {
        await conFetch(
          () => new Response("{}", { status: 201 }),
          async (calls) => {
            const result = await sendMail({
              to: "lectora@example.test",
              subject: "Alta",
              text: "cuerpo",
            });
            entregado = result.delivered;
            assert.equal(calls.length, 0, "no se llama a Brevo sin remitente");
          },
        );
      });
    } finally {
      if (nodoPrevio === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = nodoPrevio;
    }
  });

  assert.equal(entregado, false);
  assert.match(registro, /MAIL_FROM/);
});

test("si están el webhook y Brevo, manda el webhook", async () => {
  const { sendMail } = await import("../src/lib/mailer.ts");
  await conEntorno(
    {
      MAIL_WEBHOOK_URL: "https://mail.example/send",
      MAIL_WEBHOOK_TOKEN: "token-de-prueba",
      BREVO_API_KEY: "xkeysib-prueba",
      MAIL_FROM: "no-reply@biblioteca.example",
    },
    async () => {
      await conFetch(
        () => new Response("{}", { status: 200 }),
        async (calls) => {
          const result = await sendMail({
            to: "lectora@example.test",
            subject: "Alta",
            text: "cuerpo",
          });
          assert.equal(result.delivered, true);
          assert.equal(calls.length, 1);
          assert.equal(calls[0]!.url, "https://mail.example/send");
          const headers = calls[0]!.init.headers as Record<string, string>;
          assert.equal(headers.authorization, "Bearer token-de-prueba");
          assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
            to: "lectora@example.test",
            subject: "Alta",
            text: "cuerpo",
          });
        },
      );
    },
  );
});
