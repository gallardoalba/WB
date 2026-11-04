import type { MessageKey } from "./i18n";

/**
 * Categorías principales (una por ejemplar). Son deliberadamente amplias para
 * que el filtro del catálogo siga siendo útil con un catálogo pequeño; el
 * detalle fino lo aportan las etiquetas curadas.
 */
export const CATEGORIES = [
  "Humanidades",
  "Ciencias y técnica",
  "Sociedad y política",
  "Biografías",
  "Ficción",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Idioma del ejemplar; «No especificado» evita inventar datos. */
export const BOOK_LANGUAGES = [
  "No especificado",
  "Español",
  "Alemán",
  "Inglés",
  "Otro",
] as const;

export type BookLanguage = (typeof BOOK_LANGUAGES)[number];

/** Opciones del filtro: «Todos» significa no filtrar. */
export const CATALOG_LANGUAGES = ["Todos", ...BOOK_LANGUAGES] as const;

/** Estados de lectura por obra; null significa que no se ha marcado. */
export const READING_STATES = ["reading", "read"] as const;
export type ReadingStatus = (typeof READING_STATES)[number];

/** Qué entra en cada categoría; se muestra como ayuda en el filtro. */
export const CATEGORY_DESCRIPTIONS: Record<Category, MessageKey> = {
  Humanidades:
    "Filosofía, historia, arte, música, literatura, lenguas, religión y mitología.",
  "Ciencias y técnica":
    "Física, química, biología, astronomía, matemáticas, medicina e informática.",
  "Sociedad y política":
    "Sociología, economía, política, derecho, psicología y educación.",
  "Biografías": "Autobiografías, memorias, diarios y cartas.",
  "Ficción":
    "Novelas, cuentos, clásicos, crimen y thriller, ciencia ficción y fantasía, poesía, teatro y cómics.",
};

/**
 * Etiquetas curadas: la comunidad es pequeña y una lista cerrada evita
 * sinónimos duplicados y spam en el filtro.
 */
export const TAGS = [
  "Novela negra",
  "Ciencia ficción",
  "Clásicos",
  "Romántica",
  "Biografía",
  "Viajes",
  "Historia",
  "Filosofía",
  "Autoayuda",
  "Juvenil",
  "Firmado",
  "Primera edición",
] as const;

export type Tag = (typeof TAGS)[number];

export const CONDITIONS = [
  "Como nuevo",
  "Muy buen estado",
  "Buen estado",
  "Con señales de uso",
] as const;

export type Condition = (typeof CONDITIONS)[number];

export const LISTING_STATUSES = ["available", "reserved", "given", "paused", "removed"] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const REQUEST_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "completed",
  "expired",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type ViewerRole = "requester" | "owner";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  city: string;
  bio: string;
  isAdmin: boolean;
  isSuspended: boolean;
  emailVerified: boolean;
  emailNotifications: boolean;
  /** Idioma preferido para la interfaz y los correos. */
  locale: "es" | "de";
};

/** Datos que pueden exponerse en una página pública (sin correo ni rol). */
export type PublicUser = Pick<SessionUser, "id" | "name" | "city" | "bio"> & {
  /** Cuenta del equipo de moderación (solo se expone en el perfil). */
  isTeam?: boolean;
};

export type ListingView = {
  id: string;
  bookId: string;
  title: string;
  author: string;
  isbn: string | null;
  category: string;
  language: string;
  condition: string;
  city: string;
  distanceKm: number | null;
  coverUrl: string | null;
  status: ListingStatus;
  createdAt: string;
  notes: string;
  owner: { id: string; name: string };
  tags: string[];
  isMine: boolean;
  isFavorite: boolean;
  myRequestStatus: RequestStatus | null;
};

export type RequestView = {
  id: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  role: ViewerRole;
  listing: {
    id: string;
    title: string;
    author: string;
    coverUrl: string | null;
    status: ListingStatus;
  };
  requester: { id: string; name: string; city: string };
  owner: { id: string; name: string; city: string };
  messageCount: number;
  lastMessageAt: string | null;
  unreadMessages: number;
  reviewed: boolean;
  /** Confirmaciones de entrega: el intercambio se cierra cuando ambas son true. */
  confirmedByMe: boolean;
  confirmedByOther: boolean;
  /** Código que muestra quien entrega; solo lo recibe esa persona. */
  handoverCode: string | null;
  /** La otra parte debe introducir el código para confirmar la recepción. */
  handoverCodeRequired: boolean;
  delivery: DeliveryView;
};

export type PickupPointView = {
  id: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  distanceKm: number | null;
};

export type DeliveryView = {
  method: "hand" | "pickup";
  pickupPoint: Omit<PickupPointView, "distanceKm"> | null;
};

export type ActivityType = "published" | "requested" | "accepted" | "completed";

export type ActivityView = {
  id: string;
  type: ActivityType;
  actor: string;
  title: string;
  listingId: string;
  createdAt: string;
};

export type StatsView = {
  available: number;
  members: number;
  completed: number;
  cities: number;
  clubs: number;
};

export const NOTIFICATION_TYPES = [
  "request",
  "accepted",
  "declined",
  "cancelled",
  "completed",
  "expired",
  "message",
  "review",
  "comment",
  "follow",
  "moderation",
  "availability",
  "want",
  "security",
  "club",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationView = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  listingId: string | null;
  requestId: string | null;
  bookId: string | null;
  /** Ruta interna a la que llevar el aviso (perfil, comentario, ejemplar). */
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type ReviewView = {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  authorId: string;
  authorName: string;
};

export type AdminReportView = {
  id: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  reason: string;
  details: string;
  createdAt: string;
  reporter: { id: string; name: string };
};

/**
 * Comentario de una **obra**: el hilo es común a todas las copias del título.
 * `hidden` y `deleted` no son excluyentes con aparecer en la lista: el autor ve
 * su propio comentario oculto y los hilos con respuestas dejan un hueco
 * marcado en lugar de desaparecer.
 */
export type BookCommentView = {
  id: string;
  body: string;
  spoiler: boolean;
  hidden: boolean;
  deleted: boolean;
  likes: number;
  likedByMe: boolean;
  isMine: boolean;
  canDelete: boolean;
  createdAt: string;
  author: { id: string; name: string; city: string };
  replies: BookCommentView[];
};

/** Entrada del listado de conversaciones de la comunidad. */
export type ConversationView = {
  id: string;
  bookId: string;
  bookTitle: string;
  excerpt: string;
  replies: number;
  likes: number;
  createdAt: string;
  author: { id: string; name: string; city: string };
};

export type AppSnapshot = {
  user: SessionUser | null;
  view: View;
  filters: {
    q: string;
    category: string;
    /** Idioma del libro; «Todos» no filtra. */
    language: string;
    sort: SortMode;
    /** Radio en km desde la ciudad de quien mira; 0 = sin límite. */
    radius: number;
    shelf: "all" | "saved" | "mine";
    feed: "all" | "following";
    tag: string;
    /** Pestaña activa del panel de comunidad (se conserva en la URL). */
    tab: CommunityTab;
    /** Si el muro y los clubes se limitan a la ciudad de quien mira. */
    scope: CommunityScope;
  };
  listings: ListingView[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  requests: RequestView[];
  /** Intercambios abiertos de la cuenta (para el contador del menú). */
  activeRequests: number;
  activity: ActivityView[];
  conversations: ConversationView[];
  /** Clubes de la comunidad (de la ciudad si `scope` es `city`). */
  clubs: ClubView[];
  clubsTotal: number;
  readers: ReaderView[];
  readersTotal: number;
  publicLists: ReadingListView[];
  stats: StatsView;
  notifications: NotificationView[];
  unreadNotifications: number;
  unreadMessages: number;
  myPublished: number;
  /** Ciudades para las que esta cuenta quiere recibir novedades. */
  availabilityAlerts: string[];
};

export type MessageView = {
  id: string;
  /** Solo en mensajes anteriores al cifrado (o internos de pruebas). */
  body: string;
  ciphertext: string | null;
  iv: string | null;
  /** Huella de la clave del remitente (null en mensajes anteriores a la v16). */
  keyId: string | null;
  encrypted: boolean;
  createdAt: string;
  sender: { id: string; name: string };
  isMine: boolean;
};

export type PublicKeyView = {
  id: string;
  name: string;
  publicJwk: JsonWebKey | null;
  keyId: string | null;
};

export const REQUEST_STATUS_LABELS = {
  pending: "Pendiente",
  accepted: "Aceptado",
  declined: "Rechazado",
  cancelled: "Cancelado",
  completed: "Completado",
  expired: "Expirada",
} satisfies Record<RequestStatus, MessageKey>;

export const VIEWS = ["home", "discover", "shelf", "community", "exchanges"] as const;
export type View = (typeof VIEWS)[number];

/** Ruta canónica de cada vista del shell. */
export const VIEW_PATHS: Record<View, string> = {
  home: "/",
  discover: "/descubrir",
  shelf: "/estanteria",
  exchanges: "/intercambios",
  community: "/comunidad",
};

export const SORTS = ["near", "recent", "title"] as const;
export type SortMode = (typeof SORTS)[number];

export type PagedListings = {
  items: ListingView[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type PublicProfile = {
  user: PublicUser;
  listings: ListingView[];
  listingsTotal: number;
  page: number;
  pageSize: number;
  hasMoreListings: boolean;
  published: number;
  completed: number;
  comments: number;
  ratingAverage: number | null;
  ratingCount: number;
  followers: number;
  following: number;
  isFollowing: boolean;
  isBlocked: boolean;
  isMe: boolean;
  /** Fecha de registro, para mostrar la antigüedad de la cuenta. */
  memberSince: string;
};

export type ReadingListView = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  items: number;
  owner: { id: string; name: string };
  isMine: boolean;
};

export type ReadingListBook = {
  bookId: string;
  title: string;
  author: string;
  coverUrl: string | null;
  note: string;
  comments: number;
};

export type ReadingListDetail = ReadingListView & { books: ReadingListBook[] };

export type ClubView = {
  id: string;
  name: string;
  city: string;
  description: string;
  /** Etiqueta libre y recurrente («Último martes, 19:00»). */
  meetsOn: string;
  /** Próximo encuentro concreto (ISO) para ordenar y recordar. */
  meetsAt: string;
  createdAt: string;
  book: { id: string; title: string; author: string } | null;
  members: number;
  isMember: boolean;
  isMine: boolean;
  owner: { id: string; name: string };
  joinPolicy: "open" | "approval";
  /** Relación de quien mira con el club. */
  myStatus: "none" | "member" | "pending";
  memberPreview: { id: string; name: string }[];
  /** Progreso de la lectura en curso (0-100). */
  progress: number;
  progressNote: string;
  attendees: number;
  attending: boolean;
  lastActivityAt: string | null;
  /** Solicitudes de entrada pendientes (solo lo ve quien creó el club). */
  pendingRequests: number;
};

export type ClubRequestView = {
  user: { id: string; name: string; city: string };
  createdAt: string;
};

export type ReaderBadge = { id: string; label: string; hint: string; earned: boolean };

/** Recorrido de una cuenta: cifras que se derivan del uso, sin tablas nuevas. */
export type ReaderJourney = {
  shared: number;
  given: number;
  received: number;
  comments: number;
  lists: number;
  clubs: number;
  cities: number;
  km: number;
  badges: ReaderBadge[];
};

/** Ficha de una persona en el directorio de lectores. */
export type ReaderView = {
  user: PublicUser;
  published: number;
  followers: number;
  isFollowing: boolean;
  isMe: boolean;
  /** Distancia desde la ciudad de quien mira (null si no se conoce). */
  distanceKm: number | null;
  /** Obras que también ofrece quien mira: señal de afinidad real. */
  sharedBooks: number;
  clubs: number;
  lastActiveAt: string | null;
};

export const COMMUNITY_TABS = ["conversations", "activity", "clubs", "readers", "lists"] as const;
export type CommunityTab = (typeof COMMUNITY_TABS)[number];
export const COMMUNITY_SCOPES = ["region", "city"] as const;
export type CommunityScope = (typeof COMMUNITY_SCOPES)[number];

export type CommunityMetrics = {
  clubs: number;
  memberships: number;
  pendingRequests: number;
  conversations: number;
  views7d: number;
  joins7d: number;
  /** Cuentas con actividad en su segunda semana sobre las registradas hace ≥7 días. */
  retention7d: number;
  availableListings: number;
  requests30d: number;
  completed30d: number;
  activeUsers30d: number;
};

export const REPORT_TARGETS = ["listing", "user", "message", "review", "comment", "club", "request"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = [
  "Spam o publicidad",
  "Contenido inapropiado",
  "Libro no coincide con la descripción",
  "Comportamiento abusivo",
  "El libro no llegó",
  "Problema con el punto de entrega",
  "Otro",
] as const;
