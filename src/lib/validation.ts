import { z } from "zod";
import {
  BOOK_LANGUAGES,
  CATALOG_LANGUAGES,
  CATEGORIES,
  COMMUNITY_SCOPES,
  COMMUNITY_TABS,
  CONDITIONS,
  KEY_PLATFORMS,
  READING_STATES,
  REPORT_REASONS,
  REPORT_TARGETS,
  SORTS,
  TAGS,
  VIEWS,
} from "./domain";
import { findCity } from "./cities";
import { isCommonPassword } from "./passwords";
import { isValidIsbn, normalizeIsbn } from "./text";

/**
 * Ciudad: texto libre.
 *
 * El catálogo de distancias contiene una selección de ciudades de Alemania y
 * Austria, así que aquí solo se comprueba la forma; que la ciudad exista lo
 * resuelve `resolveCity()` contra OpenStreetMap al guardar (y las del catálogo
 * de siempre se reconocen sin red).
 */
const cityField = z
  .string("Escribe tu ciudad.")
  .trim()
  .min(2, "El nombre de la ciudad es demasiado corto.")
  .max(80, "El nombre de la ciudad es demasiado largo.")
  .transform((value) => findCity(value)?.name ?? value);

/** Etiquetas: máximo 3, siempre de la lista curada. */
const tagsField = z
  .array(z.string())
  .optional()
  .default([])
  .transform((values) => [...new Set(values.filter((value) => (TAGS as readonly string[]).includes(value)))])
  .refine((values) => values.length <= 3, "Puedes elegir hasta 3 etiquetas.");

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length >= min, `${label} debe tener al menos ${min} caracteres.`)
    .refine((value) => value.length <= max, `${label} no puede superar ${max} caracteres.`);

export const registerSchema = z.object({
  name: trimmed(2, 60, "El nombre"),
  // Campo trampa y prueba de humanidad (ver `lib/captcha.ts`).
  // Campo trampa: si llega relleno, el alta se descarta en silencio.
  website: z.string().max(200, "El campo oculto no puede superar 200 caracteres.").optional().default(""),
  startedAt: z.coerce.number().int().optional(),
  turnstileToken: z.string().max(4_000, "La prueba de humanidad ha caducado.").optional(),
  // El RGPD (art. 8) exige 16 años para consentir el tratamiento por sí mismo.
  // No se verifica la edad: se deja constancia de que la persona lo declara.
  ageConfirmed: z
    .boolean()
    .optional()
    .default(false)
    .refine((value) => value, "Debes tener al menos 16 años para crear una cuenta."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "El correo es demasiado largo.")
    .refine((value) => z.email().safeParse(value).success, "Introduce un correo válido."),
  password: z
    .string()
    .min(10, "La contraseña debe tener al menos 10 caracteres.")
    .max(200, "La contraseña es demasiado larga.")
    .refine((value) => !isCommonPassword(value), "Esa contraseña es demasiado habitual."),
  city: cityField,
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "El correo es demasiado largo.")
    .refine((value) => z.email().safeParse(value).success, "Introduce un correo válido."),
  password: z.string().min(1, "Escribe tu contraseña."),
  // Segundo factor opcional: solo se pide cuando la cuenta lo tiene activo.
  // Vale el código de 6 dígitos de la aplicación o uno de los de recuperación
  // (diez caracteres con un guion en medio).
  code: z
    .string()
    .trim()
    .max(20, "El código es demasiado largo.")
    .optional(),
});

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "El código debe tener 6 dígitos."),
});

export const totpSetupSchema = z.object({
  password: z.string().min(1, "Escribe tu contraseña para confirmar."),
});

export const totpDisableSchema = z.object({
  password: z.string().min(1, "Escribe tu contraseña para confirmar."),
  code: z.string().trim().max(20, "El código es demasiado largo.").optional().default(""),
});

export const listingSchema = z.object({
  title: trimmed(2, 120, "El título"),
  author: trimmed(2, 90, "El autor"),
  category: z.enum(CATEGORIES, { error: "Elige una categoría de la lista." }),
  // Obligatorios: la ficha del catálogo se filtra por idioma y por ciudad, y
  // un ejemplar sin esos datos aparece como «No especificado» en los filtros
  // sin que nadie pueda corregirlo desde el formulario.
  language: z.enum(BOOK_LANGUAGES, { error: "Elige un idioma de la lista." }),
  condition: z.enum(CONDITIONS, { error: "Elige un estado del ejemplar." }),
  // Opcional: los libros antiguos, las ediciones de autor y los folletos no
  // siempre llevan ISBN. Si viene, se normaliza y se comprueba el dígito de
  // control; si no viene, la ficha se agrupa por título y autoría y queda sin
  // verificar por ningún catálogo.
  isbn: z
    .string({ error: "El ISBN no es válido." })
    .trim()
    .optional()
    .transform((value) => normalizeIsbn(value))
    .refine((value) => value === null || isValidIsbn(value), "El ISBN no es válido."),
  city: cityField,
  tags: tagsField,
});

export const requestSchema = z.object({
  listingId: z.string().min(1, "Falta el ejemplar.").max(64, "Ese identificador no es válido."),
  message: z
    .string()
    .trim()
    .max(500, "El mensaje no puede superar 500 caracteres.")
    .optional()
    .default(""),
});

/**
 * Cambiar el estado del intercambio o archivarlo.
 *
 * Son dos acciones distintas y no se mezclan en la misma petición: con `status`
 * se acepta, rechaza, cancela o confirma la entrega; con `archived` se aparta
 * un intercambio ya cerrado de la lista de quien lo pide.
 */
export const requestUpdateSchema = z
  .object({
    status: z
      .enum(["accepted", "declined", "cancelled", "completed"], {
        error: "Ese estado no existe.",
      })
      .optional(),
    archived: z.boolean({ error: "Indica si se archiva o se devuelve a la lista." }).optional(),
  })
  .refine(
    (value) => (value.status === undefined) !== (value.archived === undefined),
    "Indica un estado o si se archiva el intercambio.",
  );

export const favoriteSchema = z.object({
  favorite: z.boolean(),
});

export const availabilityAlertSchema = z.object({
  city: cityField,
  enabled: z.boolean(),
});

/** Aviso por obra: no guarda ciudad, se usa la del perfil al notificar. */
export const bookWantSchema = z.object({
  enabled: z.boolean(),
});

export const readingStateSchema = z.object({
  status: z.enum(READING_STATES, { error: "Elige un estado de lectura." }).nullable(),
});

/**
 * Comentario de una obra. El cuerpo se guarda como texto plano (React lo
escapa):
 * no se admite HTML ni Markdown con enlaces crudos.
 */
export const commentSchema = z.object({
  body: trimmed(2, 800, "El comentario"),
  spoiler: z.boolean().optional().default(false),
  parentId: z
    .string()
    .min(1, "Falta el comentario al que respondes.")
    .max(80, "Ese identificador no es válido.")
    .optional(),
});

export const commentLikeSchema = z.object({
  liked: z.boolean(),
});

/** Identificador del dispositivo v2: 16–64 caracteres seguros para una URL. */
/**
 * Identificador de una instantánea del directorio de claves.
 *
 * Forma fija (`kys_` + UUID): lo que llega por la calle se comprueba antes de
 * tocar la base, y en el testigo antes de entrar en una URL.
 */
export const keySnapshotIdSchema = z
  .string()
  .regex(
    /^kys_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "El identificador de la instantánea no es válido.",
  );

export const deviceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, "El identificador del dispositivo no es válido.");

/**
 * Sobres del protocolo v2 dentro de un mensaje.
 *
 * El cuerpo es el mensaje de libolm y no se mira: se acota el tamaño y la forma
 * para que un envío no sea un vertedero. El servidor comprueba aparte que el
 * dispositivo del remitente es suyo y que los destinatarios son de la otra
 * parte, porque aquí no se sabe de quién es cada id.
 */
const deviceEnvelopeFields = z.object({
  recipientDeviceId: deviceIdSchema,
  type: z.union([z.literal(0), z.literal(1)]),
  body: z
    .string()
    .min(1)
    .max(64 * 1024, "El sobre es demasiado grande.")
    .regex(/^[A-Za-z0-9+/=]+$/, "El sobre no es válido."),
});

export const followSchema = z.object({
  follow: z.boolean(),
});

export const readingListSchema = z.object({
  title: trimmed(3, 60, "El título de la lista"),
  description: z
    .string()
    .trim()
    .max(280, "La descripción no puede superar 280 caracteres.")
    .optional()
    .default(""),
  // Firma en la versión pública: por defecto la lista se lee sin nombre.
  showOwner: z.boolean().optional().default(false),
});

export const readingListItemSchema = z.object({
  bookId: z.string().min(1, "Falta el libro.").max(64, "Ese identificador no es válido."),
});

export const readingListUpdateSchema = readingListSchema;

/**
 * Sobre cifrado (AES-GCM): el servidor no sabe qué contiene, solo comprueba
 * que el formato y el tamaño son razonables.
 */
const envelopeFields = {
  keyId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, "La huella de la clave no es válida."),
  ciphertext: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "El mensaje cifrado no es válido.")
    .min(24, "El mensaje cifrado no es válido.")
    // El texto va relleno a bloques de 256 bytes antes de cifrar, así que el
    // sobre es algo mayor que antes; el tope sigue acotando el abuso.
    .max(6144, "El mensaje cifrado es demasiado grande."),
  iv: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "El vector de inicialización no es válido.")
    .min(12, "El vector de inicialización no es válido.")
    .max(32, "El vector de inicialización no es válido."),
};

/**
 * Mensaje cifrado de extremo a extremo.
 *
 * El cliente actual manda un sobre por cada clave activa del destinatario
 * (`envelopes`); los clientes anteriores a la v40 mandaban un único sobre en
 * `ciphertext`/`iv`, y se sigue aceptando para no romper una pestaña abierta.
 */
export const encryptedMessageSchema = z
  .object({
    keyId: envelopeFields.keyId.optional(),
    envelopes: z.array(z.object(envelopeFields)).min(1).max(4).optional(),
    ciphertext: envelopeFields.ciphertext.optional(),
    iv: envelopeFields.iv.optional(),
    v2: z
      .object({
        senderDeviceId: deviceIdSchema,
        envelopes: z
          .array(deviceEnvelopeFields)
          .min(1, "Falta el sobre cifrado.")
          .max(20, "Demasiados dispositivos en un solo mensaje."),
      })
      .optional(),
  })
  .refine(
    (value) =>
      Boolean(value.envelopes?.length) ||
      Boolean(value.ciphertext && value.iv) ||
      Boolean(value.v2),
    { message: "Falta el sobre cifrado.", path: ["envelopes"] },
  );

/** Clave pública ECDH P-256 en formato JWK (solo la mitad pública). */
export const publicKeySchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "La clave pública no es válida."),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "La clave pública no es válida."),
  /** Ranura del dispositivo. Sin ella, los clientes antiguos publican la web. */
  platform: z
    .enum(KEY_PLATFORMS, { error: "Esa plataforma no existe." })
    .optional()
    .default("web"),
});

export type PublicKeyInput = z.infer<typeof publicKeySchema>;
export type EncryptedMessageInput = z.infer<typeof encryptedMessageSchema>;
export type ListingInput = z.infer<typeof listingSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

export const listingStatusSchema = z.object({
  status: z.enum(["paused", "available"], { error: "Ese estado no existe." }),
});

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS, { error: "Ese tipo de contenido no existe." }),
  targetId: z
    .string()
    .min(1, "Falta el contenido que denuncias.")
    .max(64, "Ese identificador no es válido."),
  reason: z.enum(REPORT_REASONS, { error: "Elige un motivo de la lista." }),
  details: z.string().trim().max(500, "El detalle no puede superar 500 caracteres.").optional().default(""),
});

export const blockSchema = z.object({
  userId: z
    .string()
    .min(1, "Falta la persona a bloquear.")
    .max(64, "Ese identificador no es válido."),
});

const CATALOG_CATEGORIES = new Set<string>(["Todos", ...CATEGORIES]);

export const catalogParamsSchema = z.object({
  view: z.enum(VIEWS, { error: "Esa vista no existe." }).optional().default("home"),
  q: z
    .string()
    .trim()
    .max(120, "La búsqueda no puede superar 120 caracteres.")
    .optional()
    .default(""),
  // Una categoría desconocida se ignora en vez de devolver un catálogo vacío.
  category: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && CATALOG_CATEGORIES.has(value) ? value : "Todos")),
  language: z.enum(CATALOG_LANGUAGES, { error: "Ese idioma no existe." }).optional().default("Todos"),
  sort: z.enum(SORTS, { error: "Ese orden no existe." }).optional().default("near"),
  // Radio en km desde la ciudad de quien mira. 0 = sin límite.
  radius: z.coerce
    .number()
    .int()
    .min(0, "El radio va de 0 a 100 km.")
    .max(100, "El radio va de 0 a 100 km.")
    .optional()
    .default(0),
  shelf: z.enum(["all", "saved", "mine"], { error: "Esa estantería no existe." }).optional().default("all"),
  // «Siguiendo» limita el muro de la comunidad a las cuentas que sigues.
  feed: z.enum(["all", "following"], { error: "Ese muro no existe." }).optional().default("all"),
  // Etiqueta curada; una desconocida se ignora en vez de vaciar el catálogo.
  tag: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && (TAGS as readonly string[]).includes(value) ? value : ""))
    .default(""),
  // Pestaña y ámbito del panel de comunidad: viajan en la URL para poder
  // compartir la vista que se está mirando.
  tab: z.enum(COMMUNITY_TABS, { error: "Esa pestaña no existe." }).optional().default("conversations"),
  scope: z.enum(COMMUNITY_SCOPES, { error: "Ese ámbito no existe." }).optional().default("region"),
  page: z.coerce
    .number()
    .int()
    .min(1, "La página empieza en 1.")
    .max(500, "No hay más de 500 páginas.")
    .optional()
    .default(1),
  // Cuántos ejemplares trae la página. El catálogo pide una fila de la rejilla
  // (una por scroll); sin este parámetro se usa el tamaño de la primera página.
  pageSize: z.coerce
    .number()
    .int()
    .min(1, "La página no puede estar vacía.")
    .max(48, "La página es demasiado grande.")
    .optional(),
  // Desde qué ejemplar continuar. El scroll infinito pide tiradas de tamaño
  // distinto (una fila según el ancho), así que cuenta por desplazamiento y no
  // por número de página: `page` sigue existiendo para los enlaces clásicos.
  offset: z.coerce
    .number()
    .int()
    .min(0, "El desplazamiento no puede ser negativo.")
    .max(5000, "El desplazamiento es demasiado grande.")
    .optional(),
});

export type CatalogParams = z.infer<typeof catalogParamsSchema>;

export const listingEditSchema = z.object({
  condition: z.enum(CONDITIONS, { error: "Elige un estado del ejemplar." }),
  city: cityField,
  tags: tagsField,
  notes: z
    .string()
    .trim()
    .max(300, "Las notas no pueden superar 300 caracteres.")
    .optional()
    .default(""),
  // Ficha de la obra. Todo opcional: si un campo no llega, se conserva el que
  // había, y así el formulario puede crecer sin romper a nadie.
  title: trimmed(2, 120, "El título").optional(),
  author: trimmed(2, 90, "El autor").optional(),
  category: z.enum(CATEGORIES, { error: "Elige una categoría de la lista." }).optional(),
  language: z.enum(BOOK_LANGUAGES, { error: "Elige un idioma de la lista." }).optional(),
  publisher: z.string().trim().max(80, "La editorial no puede superar 80 caracteres.").optional(),
  year: z.string().trim().max(12, "El año no puede superar 12 caracteres.").optional(),
  series: z.string().trim().max(80, "La colección no puede superar 80 caracteres.").optional(),
});

export const listingPatchSchema = z.union([
  z.object({ status: z.enum(["paused", "available"], { error: "Ese estado no existe." }) }),
  listingEditSchema,
]);

export const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, "Puntúa de 1 a 5.").max(5, "Puntúa de 1 a 5."),
  comment: z.string().trim().max(500, "El comentario no puede superar 500 caracteres.").optional().default(""),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Escribe tu contraseña actual."),
  newPassword: z
    .string()
    .min(10, "La nueva contraseña debe tener al menos 10 caracteres.")
    .max(200, "La contraseña es demasiado larga.")
    .refine((value) => !isCommonPassword(value), "Esa contraseña es demasiado habitual."),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Escribe tu contraseña para confirmar."),
});

export const tokenSchema = z.object({
  token: z.string().trim().min(20, "El enlace no es válido."),
});

/** Cambiar de correo: contraseña, dirección nueva y —con 2FA— un código. */
export const emailChangeSchema = z.object({
  password: z.string().min(1, "Escribe tu contraseña para confirmar."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "El correo es demasiado largo.")
    .refine((value) => z.email().safeParse(value).success, "Introduce un correo válido."),
  code: z.string().trim().max(20, "El código es demasiado largo.").optional(),
});

/** Generar códigos de recuperación nuevos exige la contraseña y un código. */
export const totpRecoverySchema = z.object({
  password: z.string().min(1, "Escribe tu contraseña para confirmar."),
  code: z
    .string()
    .trim()
    .min(6, "Introduce un código de verificación o de recuperación.")
    .max(20, "El código es demasiado largo."),
});

const accountEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "El correo es demasiado largo.")
  .refine((value) => z.email().safeParse(value).success, "Introduce un correo válido.");

export const forgotPasswordSchema = z.object({ email: accountEmail });

/** Pedir otro enlace de apelación cuando el primero se ha perdido. */
export const appealLinkSchema = z.object({ email: accountEmail });

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20, "El enlace no es válido."),
  password: z
    .string()
    .min(10, "La contraseña debe tener al menos 10 caracteres.")
    .max(200, "La contraseña es demasiado larga.")
    .refine((value) => !isCommonPassword(value), "Esa contraseña es demasiado habitual."),
});

export const profileUpdateSchema = z.object({
  name: trimmed(2, 60, "El nombre"),
  bio: z
    .string()
    .trim()
    .max(300, "La biografía no puede superar 300 caracteres.")
    .optional()
    .default(""),
  city: cityField,
  emailNotifications: z.boolean().optional().default(true),
});

export const adminActionSchema = z.object({
  action: z.enum(
    [
    "dismiss",
    "hide_listing",
    "suspend_user",
    "hide_comment",
    "cancel_request",
  ]),
  reason: z.string().trim().max(300).optional(),
  days: z.number().int().min(1).max(365).optional(),
});

/** Respuesta de la otra parte a una incidencia de entrega. */
export const incidentResponseSchema = z.object({
  response: z.string().trim().min(10).max(1000),
});

export const localeSchema = z.object({
  locale: z.enum(["es", "de", "en"], { error: "Ese idioma no existe." }),
});

/** Preferencias de visibilidad de la cuenta. */
export const privacySchema = z.object({
  profileVisibility: z.enum(["members", "followers", "private"], {
    error: "Esa visibilidad de perfil no existe.",
  }),
  cityPrecision: z.enum(["exact", "hidden"], {
    error: "Esa opción de ciudad no existe.",
  }),
  signAs: z.enum(["name", "community"], {
    error: "Esa forma de firmar no existe.",
  }),
  dmPolicy: z.enum(["mutual", "exchanged"], {
    error: "Esa opción de mensajes no existe.",
  }),
  /**
   * Contar el recorrido de los ejemplares. Opcional para no resetear la
   * preferencia desde clientes que todavía no la conocen.
   */
  showJourney: z.boolean().optional(),
});

export const moderationSchema = z.object({
  action: z.enum(
    [
      "hide_listing",
      "restore_listing",
      "suspend_user",
      "unsuspend_user",
      "hide_comment",
      "restore_comment",
    ],
    { error: "Esa acción no existe." },
  ),
  targetType: z.enum(["listing", "user", "comment"], {
    error: "Ese tipo de contenido no existe.",
  }),
  targetId: z.string().min(1, "Falta el objetivo.").max(64, "Ese identificador no es válido."),
  /** Motivo de la sanción: obligatorio al suspender, lo valida el repositorio. */
  reason: z.string().trim().max(300).optional(),
  /** Duración de la suspensión en días (1–365). */
  days: z.number().int().min(1).max(365).optional(),
});

/** Hosts de los servicios Web Push que usan los navegadores conocidos. */
const PUSH_ENDPOINT_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
];

/**
 * El endpoint lo elige el navegador, pero llega por la API: si se acepta
 * cualquier https, el servidor se convierte en un proxy para peticiones POST a
 * hosts internos (SSRF). Solo se admiten los servicios push estándar.
 */
export function isAllowedPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return (
    PUSH_ENDPOINT_HOSTS.includes(host) || host.endsWith(".notify.windows.com")
  );
}

/**
 * Suscripción a los avisos del navegador (Web Push).
 *
 * El `endpoint` lo asigna el servicio de push del navegador y siempre es https;
 * las dos claves son base64url largos. Se limita el tamaño para que una cuenta
 * no pueda llenar la tabla con cadenas enormes.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .min(10, "El endpoint del navegador no es válido.")
    .max(2000, "El endpoint del navegador no es válido.")
    .refine(isAllowedPushEndpoint, "El endpoint del navegador no es válido."),
  keys: z.object({
    p256dh: z
      .string()
      .min(20, "Falta la clave del navegador.")
      .max(200, "Falta la clave del navegador."),
    auth: z
      .string()
      .min(8, "Falta la clave del navegador.")
      .max(200, "Falta la clave del navegador."),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z
    .string()
    .min(10, "El endpoint del navegador no es válido.")
    .max(2000, "El endpoint del navegador no es válido."),
});

/**
 * Apelación de una sanción. El token llega por correo y es la única credencial:
 * quien está suspendido no puede iniciar sesión, así que no hay sesión que
 * exigir. El texto se limita para que no se convierta en un canal de abuso.
 */
export const appealSchema = z.object({
  token: z.string().trim().length(64, "El enlace no es válido."),
  message: z
    .string()
    .trim()
    .min(20, "Cuenta qué ha pasado (al menos 20 caracteres).")
    .max(2000, "La apelación es demasiado larga."),
});

/** Respuesta del equipo a una apelación. */
export const appealResolutionSchema = z.object({
  outcome: z.enum(["upheld", "rejected"], { error: "Esa decisión no existe." }),
  resolution: z
    .string()
    .trim()
    .min(10, "Explica brevemente la decisión.")
    .max(2000, "La respuesta es demasiado larga."),
  // Nombre de quien revisó, cuando la instancia no tiene a nadie del equipo
  // libre de conflicto y acude a otra instancia o a una persona de confianza.
  externalReviewer: z.string().trim().max(120, "El nombre es demasiado largo.").optional(),
});

/**
 * Claves públicas de un dispositivo (protocolo v2).
 *
 * libolm entrega base64 sin relleno: 43 caracteres para una clave de 32 bytes y
 * 86 para una firma Ed25519 de 64 bytes. El identificador de una clave de un
 * solo uso es corto y lleva su propio contador (`AAAAAw`), así que **no** se
 * valida con el patrón de las claves. Se comprueba la forma y el tamaño: el
 * servidor no puede saber si una clave es buena, pero sí rechazar basura antes
 * de guardarla, y la firma Ed25519 sí se verifica (ver `lib/ed25519.ts`).
 */
const olmKey = z.string().regex(/^[A-Za-z0-9+/]{43}$/, "La clave del dispositivo no es válida.");

const olmSignature = z
  .string()
  .regex(/^[A-Za-z0-9+/]{86}$/, "La firma del dispositivo no es válida.");

const oneTimeKeyId = z
  .string()
  .regex(/^[A-Za-z0-9+/]{1,16}$/, "El identificador de la clave no es válido.");


export const publishDeviceSchema = z.object({
  identityKey: olmKey,
  signingKey: olmKey,
  signature: olmSignature,
  oneTimeKeys: z
    .array(
      z.object({
        keyId: oneTimeKeyId,
        key: olmKey,
        signature: olmSignature,
      }),
    )
    .max(50, "Demasiadas claves de un solo uso de golpe.")
    .default([]),
  /**
   * Contraseña para dar de alta un dispositivo más, sustituir la identidad de
   * uno existente o reactivar uno retirado. No hace falta para reponer claves
   * de un solo uso, que es la operación corriente.
   */
  password: z.string().max(200, "La contraseña es demasiado larga.").optional(),
});

