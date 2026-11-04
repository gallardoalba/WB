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

/** Solo se admiten ciudades de Baden-Württemberg (se guarda el nombre canónico). */
const cityField = z
  .string()
  .trim()
  .transform((value) => findCity(value)?.name ?? value)
  .refine((value) => isKnownCity(value), "Elige una ciudad de Baden-Württemberg.");

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

const joinPolicyField = z.enum(["open", "approval"]).optional().default("open");

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length >= min, `${label} debe tener al menos ${min} caracteres.`)
    .refine((value) => value.length <= max, `${label} no puede superar ${max} caracteres.`);

export const registerSchema = z.object({
  name: trimmed(2, 60, "El nombre"),
  // Campo trampa y prueba de humanidad (ver `lib/captcha.ts`).
  website: z.string().max(200).optional().default(""),
  startedAt: z.coerce.number().int().optional(),
  turnstileToken: z.string().max(4_000).optional(),
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
  category: z.enum(CATEGORIES),
  language: z.enum(BOOK_LANGUAGES).optional(),
  condition: z.enum(CONDITIONS),
  isbn: z
    .string()
    .trim()
    .optional()
    .transform((value) => normalizeIsbn(value))
    .refine((value) => value === null || isValidIsbn(value), "El ISBN no es válido."),
  city: cityField.optional(),
  tags: tagsField,
});

export const requestSchema = z.object({
  listingId: z.string().min(1, "Falta el ejemplar.").max(64),
  message: z
    .string()
    .trim()
    .max(500, "El mensaje no puede superar 500 caracteres.")
    .optional()
    .default(""),
});

export const requestUpdateSchema = z.object({
  status: z.enum(["accepted", "declined", "cancelled", "completed"]),
  /**
   * Oficina de Deutsche Post elegida como punto de entrega. `null` explícito
   * significa entrega en mano; si se omite al aceptar, se propone la más
   * cercana a quien entrega el libro.
   */
  officeId: z
    .string()
    .regex(/^dp_[A-Za-z0-9_]{1,60}$/, "Ese punto de entrega no es válido.")
    .nullable()
    .optional(),
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
  status: z.enum(READING_STATES).nullable(),
});

export const handoverCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 cifras."),
});

export const handoverSchema = z.object({
  officeId: z
    .string()
    .regex(/^dp_[A-Za-z0-9_]{1,60}$/, "Ese punto de entrega no es válido.")
    .nullable(),
});

/**
 * Comentario de una obra. El cuerpo se guarda como texto plano (React lo
escapa):
 * no se admite HTML ni Markdown con enlaces crudos.
 */
export const commentSchema = z.object({
  body: trimmed(2, 800, "El comentario"),
  spoiler: z.boolean().optional().default(false),
  parentId: z.string().min(1).max(80).optional(),
});

export const commentLikeSchema = z.object({
  liked: z.boolean(),
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
  bookId: z.string().min(1, "Falta el libro.").max(64),
});

export const clubSchema = z.object({
  name: trimmed(3, 60, "El nombre del club"),
  city: cityField,
  description: z
    .string()
    .trim()
    .max(280, "La descripción no puede superar 280 caracteres.")
    .optional()
    .default(""),
  bookId: z.string().min(1).optional(),
  meetsOn: z.string().trim().max(80, "El día de encuentro es demasiado largo.").optional().default(""),
  meetsAt: meetsAtField,
  joinPolicy: joinPolicyField,
});

export const clubMembershipSchema = z.object({
  joined: z.boolean(),
});

export const clubInviteSchema = z.object({
  userId: z.string().min(1, "Falta la persona a invitar.").max(64),
});

export const clubMemberDecisionSchema = z.object({
  approve: z.boolean(),
});

export const clubTransferSchema = z.object({
  userId: z.string().min(1, "Falta la persona a la que ceder el club.").max(64),
});

export const clubAttendanceSchema = z.object({
  attending: z.boolean(),
});

export const clubLoanSchema = z.object({
  listingId: z.string().min(1, "Falta el ejemplar.").max(64),
  borrowerId: z.string().min(1, "Falta la persona que lo recibe.").max(64),
  dueAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de devolución no es válida.")
    .optional()
    .nullable(),
});

export const clubLoanReturnSchema = z.object({
  loanId: z.string().min(1, "Falta el préstamo.").max(64),
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
  bookId: z.string().min(1).nullable().optional(),
  joinPolicy: joinPolicyField,
  progress: z.coerce.number().int().min(0).max(100).optional().default(0),
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
  status: z.enum(["paused", "available"]),
});

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(500, "El detalle no puede superar 500 caracteres.").optional().default(""),
});

export const blockSchema = z.object({
  userId: z.string().min(1, "Falta la persona a bloquear.").max(64),
});

const CATALOG_CATEGORIES = new Set<string>(["Todos", ...CATEGORIES]);

export const catalogParamsSchema = z.object({
  view: z.enum(VIEWS).optional().default("home"),
  q: z.string().trim().max(120).optional().default(""),
  // Una categoría desconocida se ignora en vez de devolver un catálogo vacío.
  category: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && CATALOG_CATEGORIES.has(value) ? value : "Todos")),
  language: z.enum(CATALOG_LANGUAGES).optional().default("Todos"),
  sort: z.enum(SORTS).optional().default("near"),
  // Radio en km desde la ciudad de quien mira. 0 = sin límite.
  radius: z.coerce.number().int().min(0).max(100).optional().default(0),
  shelf: z.enum(["all", "saved", "mine"]).optional().default("all"),
  // «Siguiendo» limita el muro de la comunidad a las cuentas que sigues.
  feed: z.enum(["all", "following"]).optional().default("all"),
  // Etiqueta curada; una desconocida se ignora en vez de vaciar el catálogo.
  tag: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && (TAGS as readonly string[]).includes(value) ? value : ""))
    .default(""),
  // Pestaña y ámbito del panel de comunidad: viajan en la URL para poder
  // compartir «Clubes de Stuttgart» o el muro de actividad.
  tab: z.enum(COMMUNITY_TABS).optional().default("conversations"),
  scope: z.enum(COMMUNITY_SCOPES).optional().default("region"),
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
});

export type CatalogParams = z.infer<typeof catalogParamsSchema>;

export const listingEditSchema = z.object({
  condition: z.enum(CONDITIONS),
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
  z.object({ status: z.enum(["paused", "available"]) }),
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
  action: z.enum(["dismiss", "hide_listing", "suspend_user", "hide_comment", "hide_club"]),
});

export const localeSchema = z.object({
  locale: z.enum(["es", "de"]),
});

export const moderationSchema = z.object({
  action: z.enum([
    "hide_listing",
    "restore_listing",
    "suspend_user",
    "unsuspend_user",
    "hide_comment",
    "restore_comment",
    "hide_club",
    "restore_club",
  ]),
  targetType: z.enum(["listing", "user", "comment", "club"]),
  targetId: z.string().min(1, "Falta el objetivo.").max(64),
});
