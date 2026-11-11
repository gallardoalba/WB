/**
 * Avisos del navegador (Web Push).
 *
 * Lo que se guarda por dispositivo, lo que se descarta cuando un navegador deja
 * de existir y el detalle que más importa: un aviso que no llega **no** puede
 * tumbar la acción que lo provocó (aceptar una reserva, recibir un mensaje).
 * Sin `VAPID_*` en el entorno todo esto tiene que ser un no-op silencioso, que
 * es como corre la instalación mientras no haya claves.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type PushModule = typeof import("../src/lib/push.ts");
type ValidationModule = typeof import("../src/lib/validation.ts");

let push: PushModule;
let validation: ValidationModule;

before(async () => {
  await import("../src/lib/db/index.ts");
  push = await import("../src/lib/push.ts");
  validation = await import("../src/lib/validation.ts");
});

let counter = 0;

/** Suscripción con forma real: base64url largas, como las manda el navegador. */
function clave(prefix: string) {
  counter += 1;
  return `${prefix}_${"B".repeat(60)}${counter}`;
}

function endpoint(nombre = "chrome") {
  return `https://fcm.googleapis.com/fcm/send/${nombre}-${clave("top")}`;
}

function suscribir(userId: string, nombre?: string) {
  const clavePublica = clave("p256dh");
  const punto = nombre ? endpoint(nombre) : endpoint();
  push.savePushSubscription({
    userId,
    endpoint: punto,
    p256dh: clavePublica,
    auth: clave("auth"),
    userAgent: "Mozilla/5.0 (prueba)",
  });
  return punto;
}

test("sin claves VAPID no se configura nada y no se envía", async () => {
  const vacio = {};
  assert.equal(push.pushConfig(vacio), null);
  assert.equal(push.pushConfig({ VAPID_PUBLIC_KEY: "  " }), null);

  const config = push.pushConfig({
    VAPID_PUBLIC_KEY: " pública ",
    VAPID_PRIVATE_KEY: "privada",
  });
  assert.deepEqual(config, {
    publicKey: "pública",
    privateKey: "privada",
    subject: "mailto:webmaster@wanderbibliothek.org",
  });
  assert.equal(
    push.pushConfig({
      VAPID_PUBLIC_KEY: "a",
      VAPID_PRIVATE_KEY: "b",
      VAPID_SUBJECT: "mailto:hola@example.org",
    })?.subject,
    "mailto:hola@example.org",
  );

  // Con el entorno de las pruebas no hay claves: enviar devuelve 0 y no toca
  // la base de datos.
  assert.equal(await push.sendPushToUser("usr_ana", { title: "Hola" }), 0);
});

test("una suscripción se guarda una vez por endpoint y no se duplica", () => {
  const antes = push.pushSubscriptionCount("usr_clara");
  const punto = suscribir("usr_clara", "edge");
  assert.equal(push.pushSubscriptionCount("usr_clara"), antes + 1);

  // El mismo navegador vuelve a suscribirse (permiso renovado, claves nuevas):
  // la fila se refresca en lugar de acumularse.
  push.savePushSubscription({
    userId: "usr_clara",
    endpoint: punto,
    p256dh: clave("p256dh"),
    auth: clave("auth"),
  });
  assert.equal(push.pushSubscriptionCount("usr_clara"), antes + 1);
});

test("un dispositivo que cambia de cuenta se reasigna, no se copia", () => {
  const punto = suscribir("usr_clara", "compartido");
  const antesAna = push.pushSubscriptionCount("usr_ana");
  const antesClara = push.pushSubscriptionCount("usr_clara");

  push.savePushSubscription({
    userId: "usr_ana",
    endpoint: punto,
    p256dh: clave("p256dh"),
    auth: clave("auth"),
  });

  assert.equal(push.pushSubscriptionCount("usr_clara"), antesClara - 1);
  assert.equal(push.pushSubscriptionCount("usr_ana"), antesAna + 1);

  // Se devuelve a Clara para no dejar rastro en las pruebas siguientes.
  push.removePushSubscription("usr_ana", punto);
  assert.equal(push.pushSubscriptionCount("usr_ana"), antesAna);
});

test("no se acumulan más dispositivos de los que permite el tope", () => {
  const antes = push.pushSubscriptionCount("usr_diego");
  for (let i = 0; i < push.MAX_PUSH_PER_USER + 3; i += 1) {
    suscribir("usr_diego", `movil-${i}`);
  }
  assert.equal(push.pushSubscriptionCount("usr_diego"), push.MAX_PUSH_PER_USER);
  assert.ok(push.MAX_PUSH_PER_USER <= 10, "el tope debería ser pequeño");

  push.deletePushSubscriptionsForUser("usr_diego");
  assert.equal(push.pushSubscriptionCount("usr_diego"), 0);
  assert.equal(antes, push.pushSubscriptionCount("usr_diego"));
});

test("cada cuenta sólo puede borrar su propia suscripción", () => {
  const punto = suscribir("usr_ana", "privado");
  const antesClara = push.pushSubscriptionCount("usr_clara");

  // Clara no puede dar de baja el dispositivo de Ana.
  push.removePushSubscription("usr_clara", punto);
  assert.equal(push.pushSubscriptionCount("usr_clara"), antesClara);
  assert.ok(push.pushSubscriptionCount("usr_ana") >= 1);

  push.removePushSubscription("usr_ana", punto);
  assert.equal(push.pushSubscriptionCount("usr_ana"), 0);
});

test("el esquema rechaza endpoints que no son https y claves vacías", () => {
  const bueno = {
    endpoint: endpoint("valido"),
    keys: { p256dh: clave("p256dh"), auth: clave("auth") },
  };
  assert.equal(validation.pushSubscriptionSchema.safeParse(bueno).success, true);

  assert.equal(
    validation.pushSubscriptionSchema.safeParse({
      ...bueno,
      endpoint: "http://insecure.example.org/x",
    }).success,
    false,
  );
  assert.equal(
    validation.pushSubscriptionSchema.safeParse({
      endpoint: bueno.endpoint,
      keys: { p256dh: "corta", auth: bueno.keys.auth },
    }).success,
    false,
  );
  assert.equal(
    validation.pushSubscriptionSchema.safeParse({ endpoint: bueno.endpoint }).success,
    false,
  );
  assert.equal(
    validation.pushUnsubscribeSchema.safeParse({ endpoint: bueno.endpoint }).success,
    true,
  );
  assert.equal(validation.pushUnsubscribeSchema.safeParse({ endpoint: "" }).success, false);
});

test("el service worker sabe pintar el aviso y abrir su ruta", () => {
  // Sin estos dos escuchas el navegador recibe el mensaje y no muestra nada:
  // es el fallo silencioso típico de una integración de push a medias.
  const sw = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  assert.match(sw, /addEventListener\(\s*["']push["']/);
  assert.match(sw, /showNotification\(/);
  assert.match(sw, /addEventListener\(\s*["']notificationclick["']/);
});
