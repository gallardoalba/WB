import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeNotification } from "../src/lib/notification-locale.ts";

test("los avisos nuevos se guardan en el idioma de quien los recibe", () => {
  const request = localizeNotification(
    "de",
    "Nueva solicitud de intercambio",
    "Ana Martínez quiere leer «El nombre del viento».",
  );
  assert.equal(request.title, "Neue Tauschanfrage");
  assert.equal(request.body, "Ana Martínez möchte „El nombre del viento“ lesen.");

  const follow = localizeNotification("de", "Lucía Prieto empezó a seguirte", "");
  assert.equal(follow.title, "Lucía Prieto folgt dir jetzt");

  // El aviso de una sola firma distingue a quien recibe de quien entrega.
  const receipt = localizeNotification(
    "de",
    "Confirma la recepción",
    "«El nombre del viento» · Ya se ha entregado. Cuando lo tengas, confirma que lo has recibido.",
  );
  assert.equal(receipt.title, "Bestätige den Empfang");
  assert.equal(
    receipt.body,
    "„El nombre del viento“ · Es wurde bereits übergeben. Bestätige den Empfang, sobald du das Buch hast.",
  );

  const reminder = localizeNotification(
    "de",
    "Recordatorio: falta confirmar la recepción",
    "«El nombre del viento» · Lleváis unos días sin confirmar la recepción. Si ya tienes el libro, confirma que lo has recibido.",
  );
  assert.equal(reminder.title, "Erinnerung: Empfang noch nicht bestätigt");
  assert.equal(
    reminder.body,
    "„El nombre del viento“ · Ihr habt seit einigen Tagen keinen Empfang bestätigt. Wenn du das Buch bereits hast, bestätige den Empfang.",
  );

  const spanish = localizeNotification(
    "es",
    "Nueva solicitud de intercambio",
    "Ana Martínez quiere leer «El nombre del viento».",
  );
  assert.equal(spanish.title, "Nueva solicitud de intercambio");
});
