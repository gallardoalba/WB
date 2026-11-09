import { getDb } from "../db";
import type { ActivityView, AppSnapshot, ListingView, SessionUser, StatsView } from "../domain";
import { listAvailabilityAlerts } from "./alerts";
import { PAGE_SIZE, catalogPage, shelfListings, type CatalogPageParams } from "./catalog";
import { listClubs } from "./clubs";
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
 * clubes, lectores ni listas, y la comunidad no paga el catálogo. Antes se
 * calculaba todo en cada render (unas 20 consultas, varias descartadas).
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

  // El muro, los clubes y los lectores pueden limitarse a la ciudad de quien
  // mira; sin ciudad conocida se muestra la región entera.
  const scopeCity = user && params.scope === "city" ? user.city : null;
  const communityQuery = isCommunity ? params.q : undefined;

  const clubsPage =
    isCommunity && params.tab === "clubs"
      ? listClubs({ viewerId, city: scopeCity, q: communityQuery, sort: "meeting", pageSize: 3 })
      : null;
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
    // menú se resuelve con un COUNT.
    requests: isExchanges && user ? listRequests(user.id) : [],
    // Cuántos hay de verdad: la lista se corta en 500 y la vista lo avisa.
    requestsTotal: isExchanges && user ? countRequests(user.id) : 0,
    activeRequests: user ? countActiveRequests(user.id) : 0,
    activity,
    conversations,
    clubs: clubsPage?.clubs ?? [],
    clubsTotal: clubsPage?.total ?? 0,
    readers: readersPage?.readers ?? [],
    readersTotal: readersPage?.total ?? 0,
    publicLists: listsPage?.lists ?? [],
    stats: shared?.stats ?? getStats(),
    notifications: user ? listNotifications(user.id) : [],
    unreadNotifications: user ? countUnreadNotifications(user.id) : 0,
    unreadMessages: user ? countUnreadMessages(user.id) : 0,
    myPublished: user
      ? (
          getDb()
            .prepare("SELECT COUNT(*) AS count FROM listings WHERE owner_id = ? AND status <> 'removed'")
            .get(user.id) as { count: number }
        ).count
      : 0,
    availabilityAlerts: user ? listAvailabilityAlerts(user.id) : [],
  };
}
