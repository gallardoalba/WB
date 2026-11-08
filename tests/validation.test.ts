/**
 * Esquemas de validación de la cuenta y de la administración.
 *
 * Las rutas los usan antes de tocar la base; aquí se fijan los mensajes y los
 * valores por defecto, que es lo que ve la persona cuando algo no cuadra. Un
 * mensaje que falte acaba en castellano dentro de la interfaz alemana.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  adminActionSchema,
  localeSchema,
  moderationSchema,
  profileUpdateSchema,
  resetPasswordSchema,
} from "../src/lib/validation.ts";

/** Primer mensaje de error del esquema, ya legible. */
function primerError(resultado: { success: boolean; error?: { issues: { message: string }[] } }) {
  assert.equal(resultado.success, false, "se esperaba un error de validación");
  return resultado.error?.issues[0]?.message ?? "";
}

test("el perfil rellena bio y avisos cuando no se envían", () => {
  const resultado = profileUpdateSchema.safeParse({
    name: "  Ana   María  ",
    city: "Stuttgart",
  });
  assert.equal(resultado.success, true);
  assert.deepEqual(resultado.success ? resultado.data : null, {
    name: "Ana María",
    bio: "",
    city: "Stuttgart",
    emailNotifications: true,
  });
});

test("la ciudad se guarda con el nombre canónico del mapa", () => {
  const conAcentos = profileUpdateSchema.parse({
    name: "Lectora",
    city: "  stuttgart ",
  });
  assert.equal(conAcentos.city, "Stuttgart", "el catálogo reconoce la ciudad sin red");

  // Una ciudad fuera del catálogo se guarda tal cual la escribió la persona.
  const libre = profileUpdateSchema.parse({
    name: "Lectora",
    city: "  Barcelona  ",
  });
  assert.equal(libre.city, "Barcelona");
});

test("el perfil rechaza nombres y biografías fuera de rango", () => {
  assert.equal(
    primerError(profileUpdateSchema.safeParse({ name: "A", city: "Stuttgart" })),
    "El nombre debe tener al menos 2 caracteres.",
  );
  assert.match(
    primerError(profileUpdateSchema.safeParse({ name: "Ana".repeat(30), city: "Stuttgart" })),
    /no puede superar 60 caracteres/,
  );
  assert.equal(
    primerError(
      profileUpdateSchema.safeParse({
        name: "Lectora",
        city: "Stuttgart",
        bio: "x".repeat(301),
      }),
    ),
    "La biografía no puede superar 300 caracteres.",
  );
  assert.equal(
    primerError(profileUpdateSchema.safeParse({ name: "Lectora", city: "X" })),
    "El nombre de la ciudad es demasiado corto.",
  );
});

test("el perfil permite apagar los avisos por correo", () => {
  const resultado = profileUpdateSchema.parse({
    name: "Lectora",
    city: "Stuttgart",
    emailNotifications: false,
  });
  assert.equal(resultado.emailNotifications, false);
});

test("las acciones de administración son una lista cerrada", () => {
  for (const action of [
    "dismiss",
    "hide_listing",
    "suspend_user",
    "hide_comment",
    "hide_club",
    "hide_club_post",
  ]) {
    assert.equal(adminActionSchema.safeParse({ action }).success, true, action);
  }
  assert.equal(adminActionSchema.safeParse({ action: "delete_everything" }).success, false);
  assert.equal(adminActionSchema.safeParse({}).success, false);
});

test("moderar exige una acción y un tipo de contenido conocidos", () => {
  const valida = {
    action: "restore_comment",
    targetType: "comment",
    targetId: "cmt_1",
  };
  assert.equal(moderationSchema.safeParse(valida).success, true);

  assert.equal(
    primerError(moderationSchema.safeParse({ ...valida, action: "borrar_todo" })),
    "Esa acción no existe.",
  );
  assert.equal(
    primerError(moderationSchema.safeParse({ ...valida, targetType: "usuario" })),
    "Ese tipo de contenido no existe.",
  );
  assert.equal(
    primerError(moderationSchema.safeParse({ ...valida, targetId: "" })),
    "Falta el objetivo.",
  );
  assert.match(
    primerError(moderationSchema.safeParse({ ...valida, targetId: "x".repeat(65) })),
    /identificador no es válido/,
  );
});

test("el idioma solo admite los tres publicados", () => {
  for (const locale of ["es", "de", "en"]) {
    assert.equal(localeSchema.safeParse({ locale }).success, true, locale);
  }
  assert.equal(primerError(localeSchema.safeParse({ locale: "fr" })), "Ese idioma no existe.");
});

test("la contraseña nueva pasa por la lista de las habituales", () => {
  const token = "a".repeat(64);
  assert.equal(
    resetPasswordSchema.safeParse({ token, password: "contraseñaNueva123" }).success,
    true,
  );
  assert.equal(
    primerError(resetPasswordSchema.safeParse({ token, password: "corta" })),
    "La contraseña debe tener al menos 10 caracteres.",
  );
  assert.equal(
    primerError(resetPasswordSchema.safeParse({ token, password: "password123" })),
    "Esa contraseña es demasiado habitual.",
  );
  assert.match(
    primerError(resetPasswordSchema.safeParse({ token, password: "x".repeat(201) })),
    /demasiado larga/,
  );
  assert.equal(
    primerError(resetPasswordSchema.safeParse({ token: "corto", password: "contraseñaNueva123" })),
    "El enlace no es válido.",
  );
});
