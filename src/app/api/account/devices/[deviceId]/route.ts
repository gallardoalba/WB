import { json } from "@/lib/api";
import { listConversationPeers, notify, publishDevice, revokeDevice } from "@/lib/repo";
import type { PublishChange } from "@/lib/repo";
import { ensureKeySnapshotForDevice } from "@/lib/transparency";
import { deviceIdSchema, publishDeviceSchema } from "@/lib/validation";
import { route } from "@/lib/route";

/**
 * Avisa al dueño —y, cuando cambia una identidad, a quienes hablan con él— de
 * lo que no debería pasar desapercibido.
 *
 * Reponer claves de un solo uso (`keys`) no avisa: ocurre cada pocos mensajes.
 */
function warn(userId: string, change: PublishChange): void {
  const textos: Record<Exclude<PublishChange, "keys">, { title: string; body: string }> = {
    initial: {
      title: "Se ha añadido una clave de cifrado a tu cuenta",
      body: "Un dispositivo nuevo ha publicado su clave. Revisa que sea tuyo.",
    },
    another: {
      title: "Se ha añadido un dispositivo de cifrado a tu cuenta",
      body: "Otro dispositivo ha publicado su clave. Revisa que sea tuyo.",
    },
    identity: {
      title: "Nueva clave de cifrado en un dispositivo de tu cuenta",
      body: "Un dispositivo ha cambiado su clave. Revisa que seas tú.",
    },
    reactivation: {
      title: "Se ha reactivado un dispositivo de cifrado",
      body: "Un dispositivo retirado ha vuelto a publicar su clave. Si lo retiraste por haberlo perdido, cambia la contraseña ahora.",
    },
  };
  if (change === "keys") return;
  const texto = textos[change];
  notify({ userId, type: "security", title: texto.title, body: texto.body, link: "/u/" + userId });

  // Una identidad nueva invalida la clave que los pares tenían fijada: hay que
  // decirles que confirmen la huella antes de seguir enviando.
  if (change === "identity" || change === "reactivation") {
    for (const peerId of listConversationPeers(userId)) {
      notify({
        userId: peerId,
        type: "security",
        title: "Cambio de clave de cifrado",
        body: "La persona con la que hablabas ha cambiado la clave de un dispositivo. Confirma la nueva huella antes de enviar mensajes.",
        link: "/u/" + userId,
      });
    }
  }
}

/**
 * Publica la identidad de un dispositivo y sus claves de un solo uso.
 *
 * Es su propia clave: la ruta exige sesión y el `deviceId` de la URL es el que
 * se publica, así que nadie puede dar de alta un dispositivo a nombre de otra
 * cuenta. Solo viaja material público —identidad Curve25519, firma Ed25519 y
 * claves de un solo uso— y **cada pieza va firmada por el dispositivo**, que el
 * servidor verifica antes de guardar nada: una sesión robada no basta para
 * publicar una clave ajena.
 *
 * Añadir un dispositivo más, cambiar la identidad de uno existente o reactivar
 * uno retirado exige además la contraseña; reponer claves no.
 */
export const PUT = route<typeof publishDeviceSchema, "user", { deviceId: string }>(
  {
    body: publishDeviceSchema,
    limit: { bucket: "device:publish", limit: 60, windowMs: 60 * 60 * 1000 },
  },
  async ({ user, body, params }) => {
    const deviceId = deviceIdSchema.parse(params.deviceId);
    const { password, ...bundle } = body;
    const { device, change } = await publishDevice(user.id, { deviceId, ...bundle }, { password });
    warn(user.id, change);
    // Reponer claves de un solo uso no cambia el directorio; un alta, un cambio
    // de identidad o una reactivación sí, y sin instantánea nueva el dispositivo
    // se queda sin prueba hasta la del día siguiente.
    if (change !== "keys") {
      try {
        ensureKeySnapshotForDevice(user.id, deviceId);
      } catch (error) {
        // El dispositivo ya está publicado: no se rompe el alta por la firma.
        // El cron diario lo recogerá, pero queda en el registro del servidor.
        console.error("No se pudo firmar la instantánea del directorio:", error);
      }
    }
    return json({ device, change }, 200);
  },
);

/**
 * Baja lógica: deja de publicarse y pierde sus claves de un solo uso.
 *
 * No pide contraseña a propósito: quien ha perdido el dispositivo tiene que
 * poder retirarlo desde otro sitio, y retirar no da acceso a nada —al revés,
 * cierra la puerta—. El aviso de seguridad sí se manda.
 */
export const DELETE = route<undefined, "user", { deviceId: string }>(
  { limit: { bucket: "device:revoke", limit: 30, windowMs: 24 * 60 * 60 * 1000 } },
  ({ user, params }) => {
    const deviceId = deviceIdSchema.parse(params.deviceId);
    const revoked = revokeDevice(user.id, deviceId);
    if (revoked) {
      notify({
        userId: user.id,
        type: "security",
        title: "Se ha retirado un dispositivo de cifrado",
        body: "Ese dispositivo ya no recibe claves nuevas. Si no has sido tú, cambia la contraseña.",
        link: "/u/" + user.id,
      });
    }
    return json({ revoked }, 200);
  },
);
