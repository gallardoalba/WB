import { z } from "zod";
import {
  BOOK_LANGUAGES,
  CATALOG_LANGUAGES,
  CATEGORIES,
  COMMUNITY_SCOPES,
  COMMUNITY_TABS,
  CONDITIONS,
  READING_STATES,
  REPORT_REASONS,
  REPORT_TARGETS,
  SORTS,
  TAGS,
  VIEWS,
} from "./domain";
import { findCity, isKnownCity } from "./cities";
import { isCommonPassword } from "./passwords";
import { isValidIsbn, normalizeIsbn } from "./text";

/** Solo se admiten ciudades del catálogo alemán (se guarda el nombre canónico). */
const cityField = z
  .string()
  .trim()
  .transform((value) => findCity(value)?.name ?? value)
  .refine((value) => isKnownCity(value), "Elige una ciudad de Alemania.");

/** Etiquetas: máximo 3, siempre de la lista curada. */
const tagsField = z
  .array(z.string())
  .optional()
  .default([])
  .transform((values) => [...new Set(values.filter((value) => (TAGS as readonly string[]).includes(value)))])
  .refine((values) => values.length <= 3, "Puedes elegir hasta 3 etiquetas.");

/**
 * Próximo encuentro del club. Acepta el valor de `<input type="datetime-local">`
 * o un ISO completo y lo guarda normalizado; vacío significa «sin fecha».
 */
const meetsAtField = z
  .string()
  .trim()
  .max(40, "La fecha del encuentro no es válida.")
  .optional()
  .default("")
  .transform((value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  });

const joinPolicyField = z
  .enum(["open", "approval"], { error: "Elige cómo se entra al club." })
  .optional()
  .default("open");

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
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "El código debe tener 6 dígitos.")
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
  code: z.string().trim().optional().default(""),
});

export const listingSchema = z.object({
  title: trimmed(2, 120, "El título"),
  author: trimmed(2, 90, "El autor"),
  category: z.enum(CATEGORIES, { error: "Elige una categoría de la lista." }),
  language: z.enum(BOOK_LANGUAGES, { error: "Elige un idioma de la lista." }).optional(),
  condition: z.enum(CONDITIONS, { error: "Elige un estado del ejemplar." }),
  // Obligatorio: identifica la obra y da la portada servida por la app.
  isbn: z
    .string({ error: "Escribe el ISBN del libro." })
    .trim()
    .min(1, "Escribe el ISBN del libro.")
    .transform((value) => normalizeIsbn(value))
    .refine((value) => value !== null && isValidIsbn(value), "El ISBN no es válido."),
  city: cityField.optional(),
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

export const requestUpdateSchema = z.object({
  status: z.enum(["accepted", "declined", "cancelled", "completed"], {
    error: "Ese estado no existe.",
  }),
});

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

export const handoverCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 cifras."),
});

export const handoverSchema = z.object({
  /** En mano o por correo. */
  method: z.enum(["in_person", "post"], { error: "Elige en mano o por correo." }),
});

/** Código postal alemán. */
const postalCode = z.string().trim().regex(/^\d{5}$/, "El código postal tiene 5 cifras.");

/**
 * Datos del envío. Dos formas, las dos con la misma garantía: se guardan
 * cifrados y solo los ve la persona que manda el libro.
 *
 * - `packstation`: número de cliente de DHL (Postnummer) + taquilla.
 * - `address`: la dirección que indique quien recibe, si prefiere el correo
 *   normal a una taquilla.
 */
export const shippingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("packstation"),
    postNumber: z
      .string()
      .trim()
      .regex(/^\d{8,10}$/, "El número de cliente de DHL tiene entre 8 y 10 cifras."),
    station: z
      .string()
      .trim()
      .regex(
        /^packstation\s*\d{1,4}$/i,
        "Escribe la Packstation con su número (por ejemplo, «Packstation 123»).",
      ),
    postalCode,
    city: z
      .string()
      .trim()
      .min(2, "Escribe la ciudad de la Packstation.")
      .max(60, "La ciudad no puede superar 60 caracteres.")
      .regex(/^[^\d]+$/, "En la ciudad va solo el nombre, sin números."),
  }),
  z.object({
    kind: z.literal("address"),
    street: z
      .string()
      .trim()
      .min(3, "Escribe la calle y el número.")
      .max(120, "La dirección no puede superar 120 caracteres.")
      .regex(/\d/, "La dirección tiene que llevar el número de la casa."),
    postalCode,
    city: z
      .string()
      .trim()
      .min(2, "Escribe la ciudad.")
      .max(60, "La ciudad no puede superar 60 caracteres.")
      .regex(/^[^\d]+$/, "En la ciudad va solo el nombre, sin números."),
  }),
]);

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

/** Mensaje del foro de un club: texto y, si es respuesta, el mensaje padre. */
export const clubPostSchema = z.object({
  body: trimmed(2, 800, "El mensaje"),
  parentId: z
    .string()
    .min(1, "Falta el mensaje al que respondes.")
    .max(80, "Ese identificador no es válido.")
    .optional(),
});

export const clubPostLikeSchema = z.object({
  liked: z.boolean(),
});

/** Votación de la próxima lectura: entre dos y cinco obras del catálogo. */
export const clubPollSchema = z.object({
  question: trimmed(3, 120, "La pregunta de la votación"),
  bookIds: z
    .array(
      z
        .string()
        .min(1, "Falta un libro en la votación.")
        .max(64, "Ese identificador no es válido."),
    )
    .min(2, "Propón al menos dos libros.")
    .max(5, "Cinco libros es el máximo para una votación."),
});

export const clubPollVoteSchema = z.object({
  optionId: z.string().min(1, "Falta la opción.").max(64, "Ese identificador no es válido."),
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
});

export const readingListItemSchema = z.object({
  bookId: z.string().min(1, "Falta el libro.").max(64, "Ese identificador no es válido."),
});

/**
 * Dónde se ve el club y cómo entrar a la videollamada. El enlace solo admite
 * `http(s)`: un `javascript:` acabaria siendo un agujero en un enlace público.
 */
const meetsPlaceField = z
  .string()
  .trim()
  .max(120, "El sitio del encuentro no puede superar 120 caracteres.")
  .optional()
  .default("");

const meetsLinkField = z
  .string()
  .trim()
  .max(300, "El enlace no puede superar 300 caracteres.")
  .optional()
  .default("")
  .refine(
    (value) => value === "" || /^https?:\/\//i.test(value),
    "El enlace debe empezar por http:// o https://.",
  );

export const clubSchema = z.object({
  name: trimmed(3, 60, "El nombre del club"),
  city: cityField,
  description: z
    .string()
    .trim()
    .max(280, "La descripción no puede superar 280 caracteres.")
    .optional()
    .default(""),
  bookId: z.string().min(1, "Falta el libro del club.").optional(),
  meetsOn: z.string().trim().max(80, "El día de encuentro es demasiado largo.").optional().default(""),
  meetsAt: meetsAtField,
  meetsPlace: meetsPlaceField,
  meetsLink: meetsLinkField,
  joinPolicy: joinPolicyField,
});

export const clubMembershipSchema = z.object({
  joined: z.boolean(),
});

export const clubInviteSchema = z.object({
  userId: z
    .string()
    .min(1, "Falta la persona a invitar.")
    .max(64, "Ese identificador no es válido."),
});

export const clubMemberDecisionSchema = z.object({
  approve: z.boolean(),
});

export const clubTransferSchema = z.object({
  userId: z
    .string()
    .min(1, "Falta la persona a la que ceder el club.")
    .max(64, "Ese identificador no es válido."),
});

export const clubModeratorSchema = z.object({
  userId: z
    .string()
    .min(1, "Falta la persona a la que nombrar.")
    .max(64, "Ese identificador no es válido."),
  moderator: z.boolean(),
});

export const clubAttendanceSchema = z.object({
  attending: z.boolean(),
});

export const readingListUpdateSchema = readingListSchema;

export const clubUpdateSchema = z.object({
  name: trimmed(3, 60, "El nombre del club"),
  description: z
    .string()
    .trim()
    .max(280, "La descripción no puede superar 280 caracteres.")
    .optional()
    .default(""),
  meetsOn: z.string().trim().max(80, "El día de encuentro es demasiado largo.").optional().default(""),
  meetsAt: meetsAtField,
  meetsPlace: meetsPlaceField,
  meetsLink: meetsLinkField,
  bookId: z.string().min(1, "Falta el libro del club.").nullable().optional(),
  joinPolicy: joinPolicyField,
  // Sin `default(0)`: un PATCH parcial no debe reiniciar el progreso del club.
  progress: z.coerce
    .number()
    .int()
    .min(0, "El progreso va del 0 al 100.")
    .max(100, "El progreso va del 0 al 100.")
    .optional(),
  progressNote: z
    .string()
    .trim()
    .max(80, "La nota de progreso no puede superar 80 caracteres.")
    .optional()
    .default(""),
});

export const messageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Escribe un mensaje.")
    .max(800, "El mensaje no puede superar 800 caracteres."),
});

/**
 * Sobre cifrado (AES-GCM): el servidor no sabe qué contiene, solo comprueba
 * que el formato y el tamaño son razonables.
 */
export const encryptedMessageSchema = z.object({
  keyId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, "La huella de la clave no es válida."),
  ciphertext: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "El mensaje cifrado no es válido.")
    .min(24, "El mensaje cifrado no es válido.")
    .max(4096, "El mensaje cifrado es demasiado grande."),
  iv: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "El vector de inicialización no es válido.")
    .min(12, "El vector de inicialización no es válido.")
    .max(32, "El vector de inicialización no es válido."),
});

/** Clave pública ECDH P-256 en formato JWK (solo la mitad pública). */
export const publicKeySchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "La clave pública no es válida."),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "La clave pública no es válida."),
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
  // compartir «Clubes de Stuttgart» o el muro de actividad.
  tab: z.enum(COMMUNITY_TABS, { error: "Esa pestaña no existe." }).optional().default("conversations"),
  scope: z.enum(COMMUNITY_SCOPES, { error: "Ese ámbito no existe." }).optional().default("region"),
  page: z.coerce
    .number()
    .int()
    .min(1, "La página empieza en 1.")
    .max(500, "No hay más de 500 páginas.")
    .optional()
    .default(1),
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

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "El correo es demasiado largo.")
    .refine((value) => z.email().safeParse(value).success, "Introduce un correo válido."),
});

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
    "hide_club",
    "hide_club_post",
  ]),
});

export const localeSchema = z.object({
  locale: z.enum(["es", "de"], { error: "Ese idioma no existe." }),
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
      "hide_club",
      "restore_club",
      "hide_club_post",
      "restore_club_post",
    ],
    { error: "Esa acción no existe." },
  ),
  targetType: z.enum(["listing", "user", "comment", "club", "club_post"], {
    error: "Ese tipo de contenido no existe.",
  }),
  targetId: z.string().min(1, "Falta el objetivo.").max(64, "Ese identificador no es válido."),
});
