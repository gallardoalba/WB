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

// Avisos del navegador (Web Push). El cuerpo lo compone el servidor con el
// título y el texto ya traducidos; aquí solo se pinta y se decide dónde abre.
self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = {};
  }
  const titulo = typeof datos.title === "string" && datos.title ? datos.title : "Wanderbibliothek";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: typeof datos.body === "string" ? datos.body : "",
      tag: typeof datos.tag === "string" ? datos.tag : "wanderbibliothek",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: typeof datos.url === "string" ? datos.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let destino = "/";
  try {
    destino = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  } catch {
    destino = self.location.origin + "/";
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientes) => {
      for (const cliente of clientes) {
        if (cliente.url === destino && "focus" in cliente) return cliente.focus();
      }
      return self.clients.openWindow(destino);
    }),
  );
});
