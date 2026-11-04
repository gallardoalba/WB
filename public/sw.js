// Service worker mínimo: existe para que la app sea instalable y no cachea
// respuestas (evita servir datos de libros obsoletos).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Sin respondWith: la petición sigue su curso normal por la red.
});
