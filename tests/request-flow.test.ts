import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowedTargets,
  canTransition,
  listingStatusFor,
} from "../src/lib/request-flow.ts";

test("el dueño acepta o rechaza; quien solicita cancela", () => {
  assert.equal(canTransition("owner", "pending", "accepted"), true);
  assert.equal(canTransition("owner", "pending", "declined"), true);
  assert.equal(canTransition("owner", "pending", "cancelled"), false);
  assert.equal(canTransition("requester", "pending", "cancelled"), true);
  assert.equal(canTransition("requester", "pending", "accepted"), false);
});

test("un intercambio aceptado puede completarse o cancelarse por ambas partes", () => {
  assert.equal(canTransition("owner", "accepted", "completed"), true);
  assert.equal(canTransition("requester", "accepted", "completed"), true);
  assert.equal(canTransition("requester", "accepted", "cancelled"), true);
  assert.equal(canTransition("owner", "accepted", "declined"), false);
});

test("los estados finales no admiten transiciones", () => {
  for (const final of ["declined", "cancelled", "completed", "expired"] as const) {
    assert.equal(canTransition("owner", final, "accepted"), false);
    assert.equal(canTransition("requester", final, "completed"), false);
    assert.deepEqual(allowedTargets("owner", final), []);
  }
});

test("allowedTargets refleja el rol", () => {
  assert.deepEqual(allowedTargets("owner", "pending").sort(), ["accepted", "declined"]);
  assert.deepEqual(allowedTargets("requester", "pending"), ["cancelled"]);
  assert.deepEqual(allowedTargets("requester", "accepted").sort(), ["cancelled", "completed"]);
  assert.deepEqual(allowedTargets("owner", "completed"), []);
});

test("el estado del ejemplar acompaña al de la solicitud", () => {
  assert.equal(listingStatusFor("available", "accepted"), "reserved");
  assert.equal(listingStatusFor("reserved", "completed"), "given");
  assert.equal(listingStatusFor("reserved", "cancelled"), "available");
  assert.equal(listingStatusFor("reserved", "declined"), "available");
  assert.equal(listingStatusFor("given", "cancelled"), "given");
  assert.equal(listingStatusFor("available", "pending"), "available");
  assert.equal(listingStatusFor("reserved", "expired"), "reserved");
  assert.equal(listingStatusFor("paused", "expired"), "paused");
});
