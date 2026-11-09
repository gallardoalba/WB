import type { MessageKey } from "./i18n";
import type { Locale } from "./locale";

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

/**
 * Etiquetas temáticas: describen el área de conocimiento del libro, no su
 * campaña de venta. «Novela negra», «Romántica», «Firmado» o «Primera edición»
 * no ayudan a encontrar un libro por lo que trata y se retiraron. La lista es
 * cerrada: evita sinónimos duplicados y spam en el filtro.
 */
export const TAGS = [
  "Historia",
  "Filosofía",
  "Ensayo",
  "Literatura",
  "Lengua",
  "Arte",
  "Música",
  "Religión",
  "Poesía",
  "Teatro",
  "Clásicos",
  "Narrativa",
  "Divulgación",
  "Física",
  "Química",
  "Biología",
  "Matemáticas",
  "Astronomía",
  "Medicina",
  "Informática",
  "Ingeniería",
  "Sociología",
  "Política",
  "Economía",
  "Derecho",
  "Antropología",
  "Psicología",
  "Educación",
] as const;

export type Tag = (typeof TAGS)[number];

/**
 * Qué etiquetas se proponen según el género elegido.
 *
 * No es una restricción: `TAGS` sigue siendo la lista completa que valida el
 * servidor y la que se puede usar para filtrar. Esto hace que quien publica un
 * ensayo vea «Sociología» o «Economía» y quien publica una novela, «Narrativa».
 */
export const TAGS_BY_CATEGORY: Record<Category, readonly Tag[]> = {
  Humanidades: [
    "Historia",
    "Filosofía",
    "Literatura",
    "Lengua",
    "Arte",
    "Música",
    "Religión",
    "Poesía",
    "Teatro",
    "Clásicos",
    "Ensayo",
  ],
  "Ciencias y técnica": [
    "Divulgación",
    "Física",
    "Química",
    "Biología",
    "Matemáticas",
    "Astronomía",
    "Medicina",
    "Informática",
    "Ingeniería",
  ],
  "Sociedad y política": [
    "Sociología",
    "Política",
    "Economía",
    "Derecho",
    "Antropología",
    "Psicología",
    "Educación",
    "Ensayo",
    "Historia",
  ],
  Biografías: ["Historia", "Política", "Arte", "Literatura", "Música"],
  Ficción: ["Narrativa", "Clásicos", "Poesía", "Teatro"],
};

/** Etiquetas que se ofrecen para un género. */
export function tagsForCategory(category: string): readonly Tag[] {
  return TAGS_BY_CATEGORY[category as Category] ?? [];
}

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
  locale: Locale;
  /** Quién ve el perfil: toda la comunidad, solo a quienes sigo, o nadie. */
  profileVisibility: ProfileVisibility;
  /** Si la ciudad se enseña en el catálogo, la ficha y el perfil. */
  cityPrecision: CityPrecision;
  /** Con qué firma se publican reseñas y comentarios. */
  signAs: SignAs;
  /** Quién puede abrir un mensaje directo. */
  dmPolicy: DmPolicy;
};

/** Visibilidad del perfil (v48). */
export type ProfileVisibility = "members" | "followers" | "private";
/** Si la ciudad se enseña o se queda en «una ciudad» (v48). */
export type CityPrecision = "exact" | "hidden";
/** Firma de reseñas y comentarios (v48). */
export type SignAs = "name" | "community";
/** Quién puede escribir por mensaje directo (v48). */
export type DmPolicy = "mutual" | "exchanged";

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
  /**
   * Quien lo publica. Sin sesión llega **sin identidad**: `masked` es `true` y
   * el id y el nombre vienen vacíos. La ciudad va aparte, en `city`.
   */
  owner: { id: string; name: string; masked?: boolean };
  tags: string[];
  isMine: boolean;
  isFavorite: boolean;
  myRequestStatus: RequestStatus | null;
  /** Ficha bibliográfica de la edición (editable por quien publica). */
  publisher: string | null;
  year: string | null;
  series: string | null;
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
  /** Obras distintas con algún ejemplar en circulación. */
  titles: number;
  /** Kilómetros sumados por los intercambios ya cerrados. */
  km: number;
  /** Clubes con un encuentro futuro a la vista. */
  clubsUpcoming: number;
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
  "direct",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Mensaje directo entre dos personas (siempre cifrado de extremo a extremo). */
export type DirectMessageView = {
  id: string;
  senderId: string;
  isMine: boolean;
  ciphertext: string | null;
  iv: string | null;
  /** Huella de la clave con la que se cifró (la del remitente). */
  keyId: string | null;
  /** Un sobre por cada clave activa del destinatario; vacío en mensajes antiguos. */
  envelopes: MessageEnvelopeView[];
  encrypted: boolean;
  createdAt: string;
};

/** Hilo directo con otra persona y el motivo por el que se puede (o no) escribir. */
export type DirectThreadView = {
  id: string;
  peer: {
    id: string;
    name: string;
    city: string;
    keyId: string | null;
    keyJwk: JsonWebKey | null;
    keys: { platform: KeyPlatform; keyId: string; publicJwk: JsonWebKey }[];
  };
  me: {
    id: string;
    name: string;
    keyId: string | null;
    keyJwk: JsonWebKey | null;
    keys: { platform: KeyPlatform; keyId: string; publicJwk: JsonWebKey }[];
  };
  canMessage: boolean;
  reason: "ok" | "mutual" | "blocked" | "no-key";
  messages: DirectMessageView[];
};

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
  /** `true` cuando la reseña va firmada como «una de la comunidad». */
  authorAnonymous?: boolean;
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
  /** `true` cuando la persona firma como «una de la comunidad». */
  authorAnonymous?: boolean;
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
  /** Intercambios totales de la cuenta (puede ser mayor que `requests`). */
  requestsTotal: number;
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
  /** Un sobre por cada clave activa del destinatario; vacío en mensajes antiguos. */
  envelopes: MessageEnvelopeView[];
  encrypted: boolean;
  createdAt: string;
  sender: { id: string; name: string };
  isMine: boolean;
};

/** Ranuras de clave pública: una por tipo de dispositivo. */
export const KEY_PLATFORMS = ["web", "android"] as const;
export type KeyPlatform = (typeof KEY_PLATFORMS)[number];

export type PublicKeyView = {
  id: string;
  name: string;
  /** Clave de la ranura web (compatibilidad con clientes anteriores a la v40). */
  publicJwk: JsonWebKey | null;
  keyId: string | null;
  /** Todas las ranuras activas: web y app. */
  keys: { platform: KeyPlatform; keyId: string; publicJwk: JsonWebKey }[];
};

/** Sobre cifrado para una clave concreta del destinatario. */
export type MessageEnvelopeView = {
  keyId: string;
  ciphertext: string;
  iv: string;
};

export const REQUEST_STATUS_LABELS = {
  pending: "Pendiente",
  accepted: "Aceptado",
  declined: "Rechazado",
  cancelled: "Cancelado",
  completed: "Completado",
  expired: "Expirada",
} satisfies Record<RequestStatus, MessageKey>;

export const VIEWS = ["home", "discover", "shelf", "community", "exchanges", "offer"] as const;
export type View = (typeof VIEWS)[number];

/** Ruta canónica de cada vista del shell. */
export const VIEW_PATHS: Record<View, string> = {
  home: "/",
  discover: "/descubrir",
  shelf: "/estanteria",
  exchanges: "/intercambios",
  community: "/comunidad",
  offer: "/ofrecer",
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
  /** El perfil está reservado: solo se muestra el nombre y poco más. */
  restricted: boolean;
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
  /** Quien firma aceptó que su nombre se vea fuera de la sesión. */
  showOwner: boolean;
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
  /** Dónde se ve el club (una sala, una cafetería, una dirección). */
  meetsPlace: string;
  /** Enlace del encuentro (videollamada); solo `http(s)`. */
  meetsLink: string;
  createdAt: string;
  book: { id: string; title: string; author: string } | null;
  members: number;
  isMember: boolean;
  isMine: boolean;
  owner: { id: string; name: string };
  joinPolicy: "open" | "approval";
  /** Relación de quien mira con el club. */
  myStatus: "none" | "member" | "pending";
  /** Ayuda a llevar el club: ve solicitudes y retira mensajes del foro. */
  isModerator: boolean;
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

/**
 * Denuncia abierta sobre un mensaje del foro, con lo justo para decidir: qué
 * dice, quién lo escribió y quién lo denunció.
 */
export type ClubPostReportView = {
  id: string;
  reason: string;
  details: string;
  createdAt: string;
  reporter: { id: string; name: string };
  post: { id: string; body: string; author: string; status: string };
};

/**
 * Mensaje del foro de un club. Solo lo ven sus miembros; `deleted` conserva el
 * hueco del hilo cuando ya hay respuestas y `hidden` es la marca de moderación.
 */
export type ClubPostView = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; city: string };
  likes: number;
  likedByMe: boolean;
  isMine: boolean;
  canDelete: boolean;
  deleted: boolean;
  hidden: boolean;
  replies: ClubPostView[];
};

/**
 * Votación de la próxima lectura. Una por club y a la vez: `closed` marca la que
 * ya terminó (o se cerró a mano) y `votedOptionId` es lo que eligió quien mira.
 */
export type ClubPollView = {
  id: string;
  question: string;
  closed: boolean;
  totalVotes: number;
  votedOptionId: string | null;
  options: {
    id: string;
    book: { id: string; title: string; author: string };
    votes: number;
    voters: string[];
  }[];
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

export const REPORT_TARGETS = [
  "listing",
  "user",
  "message",
  "review",
  "comment",
  "club",
  "club_post",
  "request",
] as const;
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
