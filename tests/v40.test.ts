import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";
// Clave de 32 bytes en hexadecimal: los datos de envío se guardan cifrados.
process.env.APP_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

type DbModule = typeof import("../src/lib/db/index.ts");
type RepoModule = typeof import("../src/lib/repo.ts");
type ValidationModule = typeof import("../src/lib/validation.ts");

let dbModule: DbModule;
let repo: RepoModule;
let validation: ValidationModule;

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  repo = await import("../src/lib/repo.ts");
  validation = await import("../src/lib/validation.ts");
  // `req_seed_2` es la solicitud de Diego por el ejemplar de Clara.
  repo.updateRequestStatus("req_seed_2", "usr_clara", "accepted");
});

/** La solicitud de la muestra, vista por una de las dos partes. */
const requestFor = (userId: string) =>
  repo.listRequests(userId).find((item) => item.id === "req_seed_2");

/** La fila cruda, para comprobar qué se guarda de verdad en la base. */
const rawRow = () =>
  dbModule
    .getDb()
    .prepare(
      `SELECT ship_kind, ship_number, ship_station, ship_street, ship_postal_code, ship_city
         FROM requests WHERE id = ?`,
    )
    .get("req_seed_2") as {
    ship_kind: string | null;
    ship_number: string | null;
    ship_station: string | null;
    ship_street: string | null;
    ship_postal_code: string | null;
    ship_city: string | null;
  };

const packstation = {
  kind: "packstation" as const,
  postNumber: "123456789",
  station: "Packstation 123",
  postalCode: "10115",
  city: "Berlin",
};

const address = {
  kind: "address" as const,
  street: "Torstraße 42",
  postalCode: "10119",
  city: "Berlin",
};

test("un intercambio se entrega en mano salvo que se pida otra cosa", () => {
  const request = requestFor("usr_clara");
  assert.equal(request?.delivery.method, "in_person");
  assert.equal(request?.delivery.shipping, null);
});

test("cualquiera de las dos partes puede pasar la entrega a correo", () => {
  // Quien envía propone el envío…
  assert.equal(repo.setHandoverMethod("req_seed_2", "usr_clara", "post").delivery.method, "post");
  // …y quien recibe puede volver a la entrega en mano.
  assert.equal(
    repo.setHandoverMethod("req_seed_2", "usr_diego", "in_person").delivery.method,
    "in_person",
  );
  repo.setHandoverMethod("req_seed_2", "usr_diego", "post");
});

test("quien recibe guarda su Packstation con todos los datos cifrados", () => {
  const view = repo.setShippingAddress("req_seed_2", "usr_diego", packstation);
  assert.equal(view.delivery.method, "post");
  assert.equal(view.delivery.shipping?.kind, "packstation");
  assert.equal(view.delivery.shipping?.postNumber, packstation.postNumber);
  assert.equal(view.delivery.shipping?.station, "Packstation 123");
  assert.equal(view.delivery.shipping?.postalCode, "10115");
  assert.equal(view.delivery.shipping?.city, "Berlin");
  assert.equal(view.delivery.shipping?.street, "");
  assert.ok(view.delivery.shipping?.setAt);

  const row = rawRow();
  assert.equal(row.ship_kind, "packstation");
  for (const campo of ["ship_number", "ship_station", "ship_postal_code", "ship_city"] as const) {
    const valor = row[campo] ?? "";
    assert.match(valor, /^enc:v2:[0-9a-f]{12}:a:/, `${campo} tiene que guardarse cifrado y atado a su fila`);
  }
  assert.equal((row.ship_station ?? "").includes("Packstation"), false);
  assert.equal((row.ship_city ?? "").includes("Berlin"), false);
  assert.equal(row.ship_street, null);
});

test("quien recibe puede pedir el envío a su propia casa, también cifrada", () => {
  const view = repo.setShippingAddress("req_seed_2", "usr_diego", address);
  assert.equal(view.delivery.method, "post");
  assert.equal(view.delivery.shipping?.kind, "address");
  assert.equal(view.delivery.shipping?.street, "Torstraße 42");
  assert.equal(view.delivery.shipping?.postalCode, "10119");
  assert.equal(view.delivery.shipping?.city, "Berlin");
  // Los campos de la Packstation quedan vacíos: no se heredan de la vez anterior.
  assert.equal(view.delivery.shipping?.postNumber, "");
  assert.equal(view.delivery.shipping?.station, "");

  const row = rawRow();
  assert.equal(row.ship_kind, "address");
  for (const campo of ["ship_street", "ship_postal_code", "ship_city"] as const) {
    const valor = row[campo] ?? "";
    assert.match(valor, /^enc:v2:[0-9a-f]{12}:a:/, `${campo} tiene que guardarse cifrado y atado a su fila`);
  }
  assert.equal((row.ship_street ?? "").includes("Torstraße"), false);
  assert.equal(row.ship_number, null);
  assert.equal(row.ship_station, null);
});

test("quien envía no puede escribir los datos de la otra persona", () => {
  assert.throws(() => repo.setShippingAddress("req_seed_2", "usr_clara", packstation), {
    name: "ApiError",
  });
  assert.throws(() => repo.setShippingAddress("req_seed_2", "usr_clara", address), {
    name: "ApiError",
  });
});

test("el aviso no repite la dirección: solo avisa de que ya se puede enviar", () => {
  const notices = repo
    .listNotifications("usr_clara")
    .filter((notification) => notification.title === "Datos de envío listos");
  assert.equal(notices.length, 2);
  for (const notice of notices) {
    assert.equal(/Torstraße|10119|Packstation 123|123456789/.test(notice.body), false);
  }
});

test("solo la persona que entrega ve el código de entrega", () => {
  // El código va impreso dentro del libro: solo lo recibe quien lo mete.
  assert.ok(requestFor("usr_clara")?.handoverCode);
  assert.equal(requestFor("usr_diego")?.handoverCode, null);
});

test("los datos de la Packstation se validan", () => {
  assert.ok(validation.shippingSchema.safeParse(packstation).success);
  assert.ok(
    validation.shippingSchema.safeParse({ ...packstation, station: "packstation 45" }).success,
  );

  const rechazos = [
    { ...packstation, postNumber: "1234" },
    { ...packstation, station: "Packstation" },
    { ...packstation, station: "Postlagernd 123" },
    { ...packstation, postalCode: "1011" },
    { ...packstation, city: "10115 Berlin" },
    { ...packstation, city: "" },
  ];
  for (const intento of rechazos) {
    assert.equal(
      validation.shippingSchema.safeParse(intento).success,
      false,
      `debería rechazarse: ${JSON.stringify(intento)}`,
    );
  }
});

test("la dirección propia se valida", () => {
  assert.ok(validation.shippingSchema.safeParse(address).success);

  const rechazos = [
    { ...address, street: "Torstraße" },
    { ...address, street: "" },
    { ...address, postalCode: "1011" },
    { ...address, postalCode: "10119 Berlin" },
    { ...address, city: "1" },
    { ...address, city: "Berlin 10119" },
  ];
  for (const intento of rechazos) {
    assert.equal(
      validation.shippingSchema.safeParse(intento).success,
      false,
      `debería rechazarse: ${JSON.stringify(intento)}`,
    );
  }
});

test("la forma de entrega se valida sola, sin punto de entrega", () => {
  assert.equal(validation.handoverSchema.safeParse({ method: "post" }).success, true);
  assert.equal(validation.handoverSchema.safeParse({}).success, false);
  assert.equal(validation.handoverSchema.safeParse({ method: "drone" }).success, false);
});
