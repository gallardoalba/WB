import { getDb } from "../db";
import type {
  ActivityView,
  AppSnapshot,
  ListingView,
  OnboardingProgress,
  SessionUser,
  StatsView,
} from "../domain";
import { listAvailabilityAlerts } from "./alerts";
import { PAGE_SIZE, catalogPage, shelfListings, type CatalogPageParams } from "./catalog";
import { listRecentComments } from "./comments";
import { listPublicReadingLists } from "./lists";
import { countUnreadNotifications, listNotifications } from "./notifications";
import { countActiveRequests, countRequests, countUnreadMessages, listRequests } from "./requests";
import { listFollowingActivity, listFollowingComments, listReaders } from "./social";
import { getStats, listActivity } from "./stats";

/**
 * Datos de la vista que se está pintando.
 *
 * Solo se ejecutan las consultas que esa vista usa: la portada no carga
 * lectores ni listas, y la comunidad no paga el catálogo. Antes se calculaba
 * todo en cada render (unas 20 consultas, varias descartadas).
 */
export function getSnapshot(
  user: SessionUser | null,
  params: CatalogPageParams,
  shared?: { stats: StatsView; activity: ActivityView[] },
): AppSnapshot {
  const viewerId = user?.id ?? null;
  const isCatalog = params.view === "home" || params.view === "discover";
  const isShelf = params.view === "shelf";
  const isCommunity = params.view === "community";
  const isExchanges = params.view === "exchanges";

  const catalog = isCatalog ? catalogPage(viewerId, params) : null;
  const shelf = isShelf && user ? shelfListings(user.id, params.shelf, params.page) : null;

  const listings: ListingView[] = shelf?.items ?? catalog?.items ?? [];
  const total = shelf?.total ?? catalog?.total ?? 0;
  const page = shelf?.page ?? catalog?.page ?? 1;
  const pageSize = shelf?.pageSize ?? catalog?.pageSize ?? PAGE_SIZE;
  const hasMore = shelf?.hasMore ?? catalog?.hasMore ?? false;

  // El muro y los lectores pueden limitarse a la ciudad de quien mira; sin
  // ciudad conocida se muestra la región entera.
  const scopeCity = user && params.scope === "city" ? user.city : null;
  const communityQuery = isCommunity ? params.q : undefined;

  const readersPage =
    isCommunity && params.tab === "readers"
      ? listReaders({
          viewerId,
          city: scopeCity,
          q: communityQuery,
          sort: viewerId ? "near" : "followers",
          pageSize: 4,
        })
      : null;
  const listsPage =
    isCommunity && params.tab === "lists"
      ? listPublicReadingLists({ viewerId, q: communityQuery, pageSize: 3 })
      : null;

  const myPublished = user
    ? (
        getDb()
          .prepare("SELECT COUNT(*) AS count FROM listings WHERE owner_id = ? AND status <> 'removed'")
          .get(user.id) as { count: number }
      ).count
    : 0;

  const following = Boolean(user && params.feed === "following");
  const activity = !isCommunity
    ? []
    : following && user
      ? listFollowingActivity(user.id)
      : (shared?.activity ?? listActivity(8, scopeCity));
  const conversations = !isCommunity
    ? []
    : following && user
      ? listFollowingComments(user.id, 6)
      : listRecentComments(4, user ? { id: user.id, isAdmin: user.isAdmin } : null, scopeCity);

  return {
    user,
    view: params.view,
    filters: {
      q: params.q,
      category: params.category,
      language: params.language,
      sort: params.sort,
      radius: params.radius,
      shelf: params.shelf,
      feed: params.feed,
      tag: params.tag,
      tab: params.tab,
      scope: params.scope,
    },
    listings,
    total,
    page,
    pageSize,
    hasMore,
    // La lista completa solo la usa la vista de intercambios; el contador del
    // menú se resuelve con un COUNT. Los archivados van aparte, para que la
    // pestaña del cajón no dependa de una segunda petición al abrirse.
    requests: isExchanges && user ? listRequests(user.id) : [],
    // Cuántos hay de verdad: la lista se corta en 500 y la vista lo avisa.
    requestsTotal: isExchanges && user ? countRequests(user.id) : 0,
    archivedRequests:
      isExchanges && user ? listRequests(user.id, { archived: "archived" }) : [],
    archivedRequestsTotal:
      isExchanges && user ? countRequests(user.id, { archived: "archived" }) : 0,
    activeRequests: user ? countActiveRequests(user.id) : 0,
    activity,
    conversations,
    readers: readersPage?.readers ?? [],
    readersTotal: readersPage?.total ?? 0,
    publicLists: listsPage?.lists ?? [],
    stats: shared?.stats ?? getStats(),
    notifications: user ? listNotifications(user.id) : [],
    unreadNotifications: user ? countUnreadNotifications(user.id) : 0,
    unreadMessages: user ? countUnreadMessages(user.id) : 0,
    myPublished,
    availabilityAlerts: user ? listAvailabilityAlerts(user.id) : [],
    // Solo la portada pinta la lista de primeros pasos; el resto de vistas no
    // paga la consulta extra.
    onboarding:
      user && params.view === "home" ? onboardingProgress(user, myPublished) : NO_ONBOARDING,
  };
}

const NO_ONBOARDING: OnboardingProgress = {
  profile: false,
  published: false,
  requested: false,
  following: false,
};

/**
 * Qué le falta a una cuenta para arrancar.
 *
 * Se pregunta a la base y no al cliente: el recorrido de la persona (perfil,
 * publicaciones, solicitudes y seguimiento) es lo que decide qué se tacha, y
 * así da igual el dispositivo desde el que entre.
 */
function onboardingProgress(
  user: SessionUser,
  published: number,
): OnboardingProgress {
  // El perfil y las publicaciones ya se conocen: solo faltan dos EXISTS, ambos
  // con índice por la primera columna.
  const row = getDb()
    .prepare(
      `SELECT
         EXISTS(SELECT 1 FROM requests WHERE requester_id = @userId) AS requested,
         EXISTS(SELECT 1 FROM follows WHERE follower_id = @userId) AS following`,
    )
    .get({ userId: user.id }) as
    | { requested: number; following: number }
    | undefined;
  return {
    profile: user.bio.trim() !== "",
    published: published > 0,
    requested: Boolean(row?.requested),
    following: Boolean(row?.following),
  };
}
