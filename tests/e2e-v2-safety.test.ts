/**
 * Número de seguridad de los dispositivos v2.
 *
 * Detecta cambios respecto a una comparación anterior; el primer contacto sigue
 * siendo TOFU. Lo que se fija aquí:
 *
 * - los dos lados calculan el mismo número, sin importar quién lo pida;
 * - añadir un dispositivo —o cambiar una clave— cambia el número;
 * - sin dispositivos en alguna de las dos partes no hay nada que comparar;
 * - el formato es el que se lee en voz alta: doce grupos de cinco dígitos.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatSafetyNumber, v2SafetyNumber, type DeviceFingerprint } from "../src/lib/e2e-v2-safety.ts";

const dispositivo = (deviceId: string, seed = "a"): DeviceFingerprint => ({
  deviceId,
  identityKey: `${seed.repeat(42)}A`,
  signingKey: `${seed.repeat(42)}B`,
});

test("los dos lados calculan el mismo número", async () => {
  const ana = [dispositivo("ana-uno", "a"), dispositivo("ana-dos", "b")];
  const bruno = [dispositivo("bruno-uno", "c")];

  const desdeAna = await v2SafetyNumber(ana, bruno);
  const desdeBruno = await v2SafetyNumber(bruno, ana);
  assert.equal(desdeAna, desdeBruno, "la huella no depende de quién la calcula");
  assert.match(desdeAna!, /^\d{60}$/, "sesenta dígitos");
  assert.match(formatSafetyNumber(desdeAna)!, /^(\d{5} ){11}\d{5}$/, "doce grupos de cinco");
});

test("añadir un dispositivo o cambiar una clave cambia el número", async () => {
  const bruno = [dispositivo("bruno-uno", "c")];
  const antes = await v2SafetyNumber([dispositivo("ana-uno", "a")], bruno);
  const conOtro = await v2SafetyNumber(
    [dispositivo("ana-uno", "a"), dispositivo("ana-dos", "b")],
    bruno,
  );
  const claveNueva = await v2SafetyNumber(
    [dispositivo("ana-uno", "d")],
    bruno,
  );

  assert.notEqual(antes, conOtro, "un dispositivo más se ve");
  assert.notEqual(antes, claveNueva, "una clave distinta se ve");
});

test("sin dispositivos en alguna de las dos partes no hay número", async () => {
  const ana = [dispositivo("ana-uno")];
  assert.equal(await v2SafetyNumber(ana, []), null);
  assert.equal(await v2SafetyNumber([], ana), null);
  assert.equal(formatSafetyNumber(null), null);
});

test("los identificadores de cuenta forman parte de la huella", async () => {
  const ana = [dispositivo("ana-uno", "a")];
  const bruno = [dispositivo("bruno-uno", "c")];

  const desdeAna = await v2SafetyNumber(ana, bruno, { me: "usr_ana", peer: "usr_bruno" });
  const desdeBruno = await v2SafetyNumber(bruno, ana, { me: "usr_bruno", peer: "usr_ana" });
  assert.equal(desdeAna, desdeBruno, "sigue sin depender de quién la calcula");

  const otraCuenta = await v2SafetyNumber(ana, bruno, { me: "usr_ana", peer: "usr_carla" });
  assert.notEqual(desdeAna, otraCuenta, "cambiar el titular cambia la huella");
});
