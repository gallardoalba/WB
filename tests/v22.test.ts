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

  const club = localizeNotification(
    "de",
    "Te han invitado a un club",
    "Diego Ríos te invita a «Club de los martes».",
  );
  assert.equal(club.title, "Du wurdest in einen Club eingeladen");
  assert.equal(club.body, "Diego Ríos lädt dich zu „Club de los martes“ ein.");

  const follow = localizeNotification("de", "Lucía Prieto empezó a seguirte", "");
  assert.equal(follow.title, "Lucía Prieto folgt dir jetzt");

  const spanish = localizeNotification(
    "es",
    "Nueva solicitud de intercambio",
    "Ana Martínez quiere leer «El nombre del viento».",
  );
  assert.equal(spanish.title, "Nueva solicitud de intercambio");
});
