# Wanderbibliothek

Plataforma bilingüe (**castellano** por defecto y **alemán**) para **compartir e intercambiar libros físicos** entre lectores de **toda Alemania**, con capa social: fichas públicas, perfiles, actividad, avisos y conversación dentro de cada intercambio.

El idioma se elige con el selector del panel superior (banderas ES/DE). La preferencia se guarda en la cookie `wanderbibliothek-locale` y, si hay sesión, también en la cuenta (`users.locale`), así que se mantiene en cualquier dispositivo. Los textos que aún no tienen traducción caen al castellano, nunca a una clave técnica.

## Arrancar

Requiere Node.js 22 o superior.

```bash
git clone https://github.com/gallardoalba/wanderbibliothek.git
cd wanderbibliothek

npm install
npm run dev        # http://localhost:3000
```

La base SQLite se crea sola en `.data/wanderbibliothek.db` y se siembra con datos de demostración la primera vez.

```bash
npm run lint       # ESLint
npm test           # pruebas unitarias + integración del repositorio
npm run build      # build de producción
npm run db:reset   # borra la base local (se vuelve a sembrar al arrancar)
```

### Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `WANDERBIBLIOTHEK_DB` | `.data/wanderbibliothek.db` | Ruta del archivo SQLite (`:memory:` para pruebas) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Base para `sitemap.xml` y `robots.txt` |
| `TRUST_PROXY` | sin definir | `1` solo si hay un proxy propio delante: autoriza leer `X-Forwarded-For`/`X-Forwarded-Host` y activa las cuotas por IP. Sin él se aplican solo las cuotas globales y por cuenta (más altas), para que todas las personas no compartan un mismo cubo |
| `MAINTENANCE_TOKEN` | sin definir | Token del cron: `POST /api/cron/maintenance` con `Authorization: Bearer <token>`. Sin él el endpoint responde 404 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | sin definir | Crean el primer administrador si no existe ninguna cuenta admin (contraseña de 12+ caracteres) |
| `MAIL_WEBHOOK_URL` | sin definir | Endpoint que recibe `{to, subject, text}` para enviar los correos de verificación, recuperación y avisos. Los envíos pasan por `mail_outbox` con reintentos. Admite `MAIL_WEBHOOK_TOKEN` para autenticarse con `Bearer` |
| `APP_ENCRYPTION_KEY` | sin definir | 32 bytes en hex o base64 para cifrar secretos reversibles (TOTP y datos de envío). Obligatoria |
| `APP_ENCRYPTION_KEY_ID` | derivado | Nombre legible de la clave activa (p. ej. `2026-11`); si falta se usa un prefijo de su SHA-256 |
| `APP_ENCRYPTION_OLD_KEYS` | vacío | Claves anteriores **solo para leer**, separadas por comas, mientras se completa una rotación |
| `WANDERBIBLIOTHEK_ALLOW_PLAINTEXT` | vacío | Solo desarrollo: guarda los secretos en claro si no hay clave. Nunca en producción |
| `WANDERBIBLIOTHEK_BACKUP_KEY` | sin definir | 32 bytes en hex o base64. Si está definida, `db:backup` guarda la copia cifrada con AES-256-GCM (`db:decrypt` para restaurarla) |
| `REQUIRE_EMAIL_VERIFICATION` | sin definir | `1` exige el correo confirmado para publicar, solicitar, comentar y escribir mensajes |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | sin definir | Activan Cloudflare Turnstile en el registro. Sin ellas se usa honeypot + tiempo mínimo |
| `ERROR_WEBHOOK_URL` / `ERROR_WEBHOOK_TOKEN` | sin definir | Reciben los errores 500 en JSON (Sentry, Logtail o webhook propio) |
| `WANDERBIBLIOTHEK_BACKUP_KEEP` | `14` | Copias de seguridad que se conservan al rotar |
| `WANDERBIBLIOTHEK_BACKUP_HOOK` | sin definir | Comando que recibe `BACKUP_FILE` para copia externa (rsync, rclone…) |
| `AUDIT_RETENTION_DAYS` | `0` | Días que se conserva `admin_audit` en el mantenimiento (0 = para siempre) |
| `LEGAL_CONTROLLER` / `LEGAL_ADDRESS` / `LEGAL_CONTACT_EMAIL` | sin definir | Rellenan `/privacidad` y `/aviso-legal`; sin ellas las páginas avisan de que están incompletas |
| `WANDERBIBLIOTHEK_COVER_CACHE` | junto a la base | Carpeta donde se cachean las portadas descargadas |
| `SEED_DEMO` | `1` fuera de producción | Sembrar los datos de demostración. En producción nunca ocurre salvo que se ponga `1` a propósito |

La base se crea con permisos `0600` dentro de `.data` (`0700`). Usa `npm run db:backup` (API `.backup()` de SQLite) en vez de copiar el fichero en caliente.

### Usuarios de demostración

Solo existen en desarrollo (`NODE_ENV !== "production"`) o con `SEED_DEMO=1`. Contraseña común: `demo1234`

| Correo | Nombre | Ciudad | Rol |
| --- | --- | --- | --- |
| `ana@wanderbibliothek.test` | Ana Martínez | Stuttgart | lectora |
| `clara@wanderbibliothek.test` | Clara Montes | Stuttgart | lectora |
| `diego@wanderbibliothek.test` | Diego Ríos | Mannheim | lector |
| `lucia@wanderbibliothek.test` | Lucía Prieto | Karlsruhe | lectora |
| `marcos@wanderbibliothek.test` | Marcos Gil | Freiburg im Breisgau | lector |
| `admin@wanderbibliothek.test` | Equipo Wanderbibliothek | Stuttgart | **administración** (`/admin`) |

En un despliegue real: define `ADMIN_EMAIL`/`ADMIN_PASSWORD` o ejecuta
`npm run admin:create -- tu@correo 'contraseña-larga'`.

## Rutas

Sin sesión solo se puede ver la portada (`/`), las páginas legales (`/privacidad`, `/aviso-legal`) y los flujos de cuenta que necesitan enlace propio (`/restablecer`, `/verificar`). El catálogo completo (`/descubrir`) exige sesión: muestra el nombre y la ciudad de cada lector. El resto de páginas redirigen al acceso (`/?auth=1&next=…`); el `sitemap.xml` anuncia únicamente la portada y `robots.txt` veta el catálogo y los perfiles.

| Ruta | Contenido |
| --- | --- |
| `/` | Portada: hero y, **al pie del panel**, cuatro cifras (ejemplares, intercambios, lectores y clubes de lectura) y **una sola fila de libros**; es la vista pública por defecto. Acepta `?view=` por compatibilidad con enlaces antiguos. |
| `/descubrir` | Catálogo completo con búsqueda, categorías, orden, filtros y paginación en la URL (`?q`, `?category`, `?sort`, `?tag`, `?page`). **Exige sesión.** |
| `/privacidad`, `/aviso-legal` | Política de privacidad (art. 13 RGPD) y aviso legal (Impressum). Públicas, en castellano y alemán, con los datos del responsable de `LEGAL_*`. |
| `/estanteria`, `/intercambios`, `/comunidad` | Secciones privadas de la app; sin sesión redirigen al acceso conservando el destino en `?next=`. |
| `/cuenta` | Ajustes de la cuenta: perfil y ciudad, avisos, contraseña, cifrado de mensajes, verificación en dos pasos, descarga de datos y borrado. |
| `/?notifications=1` | Abre la bandeja de avisos sobre la portada (`?profile=1` redirige a `/cuenta`). |
| `/libro/[id]` | Ficha: estado, ISBN, notas del ejemplar, dueño, solicitud, guardar, denunciar, datos estructurados `Book`/`Offer` |
| `/u/[id]` | Perfil: biografía, métricas, valoración media, **reseñas**, estantería, bloquear/denunciar |
| `/lectores` | Directorio de lectores con búsqueda, ciudad y orden por cercanía o actividad |
| `/comunidad` | Hub de comunidad: conversaciones, actividad, clubes, lectores y listas, con el ámbito (región/ciudad) en `?scope=`. Las **secciones van arriba**, debajo del título, y la descripción del muro justo después. Sin banda de cifras (las hay en la portada) y sin buscador propio: el de la cabecera sirve para todo. |
| `/ofrecer` | **Publicar un libro**, en página propia (`?offer=1` redirige aquí). Exige sesión y vive dentro del shell: mismo panel lateral y misma cabecera que el resto de vistas |
| `/buscar` | **Buscador global** (`?q=`): obras, clubes, lectores y listas públicas en una sola página, con enlace a la sección completa para seguir filtrando. Es lo que hay detrás del campo de la cabecera |
| `/listas` | Listas de lectura públicas de la comunidad |
| `/clubes` | Clubs de lectura por ciudad: crear, unirse, lectura en curso y día de encuentro |
| `/clubes/[clubId]` | Detalle del club: **las acciones de quien lo dirige van arriba** (compartir, invitar, gestionar miembros y moderadores, y **editar en una ventana**, con el cierre dentro); debajo, la banda de **solicitudes pendientes** y tres fichas —lectura en curso con progreso, encuentro con asistencia e histórico, y miembros (solo para quienes están dentro)—; la **votación de la próxima lectura**, la **moderación del club** (mensajes denunciados, solo si hay) y el **foro** a todo el ancho. El sitio y el enlace del encuentro, la lista de miembros y «Denunciar club» son **solo para miembros** |
| `/listas/[listId]` | Lista de lectura pública de un lector (curaduría compartible, editable por su dueño) |
| `/obra/[bookId]` | **Obra canónica**: conversación del título (comentarios, respuestas, spoilers, me gusta), ejemplares disponibles, recomendaciones por categoría y etiquetas, y datos estructurados `Book` |
| `/admin` | Solo administración, con entrada propia **Moderación** en el panel lateral: denuncias paginadas, incidencias de intercambio, cuentas suspendidas, comentarios ocultos, auditoría y métricas de producto. **Sin el segundo factor activo no da 404**: la página se titula «Moderación de la comunidad» y su puerta explica el requisito y enlaza a `/cuenta` para activarlo |
| `/?auth=1` | Abre el diálogo de acceso |
| `/api/health` | Estado del servicio y de la base de datos |
| `/api/cover/[isbn]` | Portada del ISBN, descargada y cacheada por el servidor: el navegador no contacta con ningún servicio de portadas |
| `/api/cover/book/[bookId]` | `GET` la portada que ha subido quien publica la obra · `PUT` la sube (cuerpo binario, solo el dueño o la administración) · `DELETE` la retira |
| `/api/account/keys` | `GET` estado e historial de la clave de cifrado · `PUT` publica la de este navegador (rotar exige contraseña) |
| `/api/account/verify-email` | `POST` reenvía el enlace de confirmación |
| `/api/account/delete`, `/api/account/export` | `POST` borra la cuenta con contraseña · `GET` descarga todos los datos en JSON |
| `/api/auth/me`, `/api/auth/logout` | Sesión actual · cierre de sesión |
| `/api/listings`, `/api/listings/[id]` | `POST` publica un ejemplar · `PATCH`/`DELETE` lo editan o retiran · `…/favorite` guarda o quita de la estantería |
| `/api/blocks` | `POST` bloquea o desbloquea a otra cuenta |
| `/api/requests/[requestId]/events` | Canal en vivo (SSE) de la conversación: avisa de mensajes nuevos sin enviar contenido |
| `/api/admin/reports`, `/api/admin/reports/[id]` | Bandeja de denuncias e incidencias, con resolución por id |
| `/manifest.webmanifest`, `/sw.js` | Manifest e instalación como aplicación (service worker mínimo, sin caché de datos) |
| `/api/cron/maintenance` | Tareas programadas (caducidad y purgas) con `MAINTENANCE_TOKEN` |
| `/api/account/profile` | `PATCH`: nombre, ciudad, biografía y preferencia de correo del propio perfil |
| `/api/account/locale` | `POST`: guarda el idioma preferido de la cuenta |
| `/api/alerts/availability` | `POST`: activa o desactiva los avisos de novedades de una ciudad |
| `/api/requests` | `GET`: solicitudes propias · `POST`: crea una solicitud de intercambio |
| `/api/reports` | `POST`: denuncia ejemplares, perfiles, mensajes, comentarios, reseñas, clubs o una **incidencia de intercambio** (`targetType: "request"`) |
| `/api/account/totp` | `GET`: estado de la verificación en dos pasos · `POST /setup`, `/enable`, `/disable` |
| `/verificar`, `/restablecer` | Confirmar el correo y elegir una contraseña nueva desde el enlace |
| `/api/auth/verify`, `/api/auth/forgot`, `/api/auth/reset` | Flujos de cuenta con token de un solo uso |
| `/api/notifications/[id]` | `PATCH` (marcar leído) y `DELETE` (eliminar) de un aviso |
| `/api/users/[userId]/follow` | `POST`: seguir o dejar de seguir (`{ follow }`) |
| `/api/direct/[userId]` | `GET` hilo privado con esa persona (motivo y mensajes cifrados) · `POST` envía un sobre cifrado (solo con seguimiento mutuo) |
| `/api/direct/[userId]/read` | `POST` marca la conversación como leída |
| `/api/lists`, `/api/lists/[listId]/items` | `POST` de lista, alta y baja de obras en la lista |
| `/api/lists/[listId]` | `PATCH`: título y descripción · `DELETE`: borrar la lista |
| `/api/clubs`, `/api/clubs/[clubId]/membership` | `POST` de club y altas/bajas de miembros |
| `/api/clubs/[clubId]` | `PATCH`: nombre, encuentro y lectura · `DELETE`: cerrar el club |
| `/api/books/[bookId]/comments` | `GET` público del hilo (cursor `?before=<id>`) y `POST` para comentar o responder |
| `/api/books/[bookId]/want` | `GET` estado del aviso por obra · `POST` activa o desactiva «avísame si aparece en mi ciudad» |
| `/api/books/[bookId]/reading-state` | `GET` estado de lectura · `POST` «leyendo», «leído» o quitar la marca |
| `/api/clubs/[clubId]/polls` | `GET` la votación abierta · `POST` la abre (dos a cinco obras) |
| `/api/clubs/[clubId]/polls/[pollId]/vote` | `POST` el voto de un miembro (se puede cambiar) |
| `/api/clubs/[clubId]/polls/[pollId]/close` | `POST` cierra la votación |
| `/api/books` | `GET ?q=` busca obras del catálogo (selector de lectura y votaciones) |

Los datos de demostración (`SEED_DEMO=1`) incluyen un club con miembros, mensajes en el foro
y una votación abierta; `e2e/clubs.spec.ts` recorre esa ficha y comprueba que quien no es
miembro no ve el foro.
| `/api/clubs/[clubId]/posts` | `GET` y `POST` del **foro del club** (solo miembros; `?before=` pagina) |
| `/api/clubs/[clubId]/posts/[postId]` | `DELETE`: borra el mensaje (autor, quien creó el club o administración) |
| `/api/clubs/[clubId]/posts/[postId]/like` | `POST` del «me gusta» dentro del club |
| `/api/requests/[requestId]/handover/verify` | `POST` confirma la recepción con el código de entrega de 6 cifras |
| `/api/comments/[commentId]` | `DELETE`: borra el propio comentario (con respuestas deja un hueco marcado) |
| `/api/comments/[commentId]/body` | `GET`: texto de un comentario con spoiler, que no viaja en el hilo hasta que se pide |
| `/api/comments/[commentId]/like` | `POST`: me gusta idempotente (no vale el propio) |
| `/api/admin/moderation` | Acciones directas: retirar/restablecer ejemplar, suspender/reactivar cuenta, ocultar/restablecer comentario o club |
| `/sitemap.xml`, `/robots.txt` | Indexación (el sitemap solo publica la portada) |

Es una selección: hay **71 endpoints** en `src/app/api`. Casi todos se declaran con
`route()` (`src/lib/route.ts`), que aplica en un solo sitio la sesión, el esquema Zod
del cuerpo, la cuota con guardia de origen y `handleApiError()`; el resto conserva el
patrón a mano (`guard()` + `try/catch`) y `tests/route.test.ts` comprueba sobre los
ficheros que ninguna ruta se quede sin traducir errores a JSON ni acepte mutaciones
de otro origen.

## Arquitectura

Monolito modular con Next.js 16 (App Router, Cache Components), TypeScript y SQLite.

```
src/
  app/
    page.tsx                  Server Component: portada/catálogo + snapshot (`instant = false`)
    manifest.ts               Manifest de la aplicación instalable (nombre, colores, iconos)
    libro/[id]/page.tsx       Ficha con metadatos y JSON-LD
    obra/[bookId]/page.tsx    Obra canónica: conversación del título y ejemplares
    u/[id]/page.tsx           Perfil público (oculto si la cuenta está suspendida)
    comunidad/page.tsx        Hub de comunidad (conversaciones, actividad, clubes, lectores, listas)
    lectores/page.tsx         Directorio de lectores con filtros
    clubes/ page.tsx y [clubId]/ Detalle de club con miembros y ajustes
    listas/[listId]/page.tsx  Lista de lectura pública
    admin/page.tsx            Panel de moderación y métricas de producto (solo rol admin)
    error.tsx / not-found.tsx / sitemap.ts / robots.ts
    api/                      auth, listings, requests, reports, blocks, notifications, account, admin, cron, health, books, comments, lists, clubs, users
    proxy.ts                  CSP con nonce y cabeceras de seguridad (convención `proxy`)
    styles/                   tokens · tipografía · estructura · portada · tarjetas · comunidad · diálogos · fichas · responsive · comentarios · grafo social · descubrimiento · clubs
  components/
    wanderbibliothek-app.tsx         Shell cliente con estado en la URL y pestañas de comunidad
    site-shell.tsx            Shell de páginas internas + PageHeader (Server Component)
    site-rail.tsx             Barra lateral de páginas internas (Server Component)
    i18n-provider.tsx         Traducción en cliente: recibe los textos del layout, no el diccionario
    app-sidebar.tsx           Barra lateral del catálogo (navegación y menú de cuenta)
    account-menu.tsx          Menú único: perfil, ciudad, avisos, moderación y salir
    exchanges-list.tsx        Lista de intercambios con siguiente paso, entrega y última actividad
    listing-card.tsx          Tarjeta compartida (catálogo, perfil)
    listing-actions.tsx       Solicitar, guardar, pausar, retirar, editar, denunciar
    book-comments.tsx         Hilo de la obra: comentar, responder, me gusta, spoiler bajo demanda
    list-picker.tsx           Añadir la obra a una lista propia desde la ficha
    list-actions.tsx          Editar, borrar listas y quitar obras
    club-board.tsx            Crear club, unirse/salir y ajustes del club
    reader-card.tsx           Tarjeta de lector con botón de seguir
    profile-actions.tsx       Bloquear/desbloquear y denunciar perfil
    admin-reports.tsx         Resolución de denuncias
    admin-sanctions.tsx       Cuentas suspendidas (reactivar), comentarios ocultos y auditoría
    dialog.tsx                Diálogo accesible (foco atrapado, Escape, aria)
    confirm-dialog.tsx        Confirmación accesible de acciones destructivas
    theme-toggle.tsx          Conmutador claro/oscuro persistido
    dialogs.tsx               Fachada: reexporta los diálogos de `dialogs/`
    dialogs/                  Acceso, publicar, avisos, intercambio + valoración, perfil y utilidades comunes
    book-cover.tsx            Portada por ISBN con reserva si falta
    book-want-button.tsx      «Avísame de nuevos ejemplares» por obra y ciudad
    reading-state-buttons.tsx «Leyendo» / «Leído» por obra
    handover-code.tsx         QR y código de entrega del intercambio
    club-forum.tsx            Foro del club: tablón, respuestas y me gusta
    club-poll.tsx             Votación de la próxima lectura
    book-picker.tsx           Buscador de obras para elegir lectura
    pwa-register.tsx          Registro del service worker solo en producción
  lib/
    domain.ts                 Tipos y enums compartidos (etiquetas curadas incluidas)
    cities.ts                 Las 123 ciudades de Alemania y sus distancias
    db/index.ts               Conexión única, caché de sentencias y arranque de la base
    db/schema.ts              Esquema base (v2), índices y constante `SCHEMA_VERSION`
    db/migrations.ts          Escalera de migraciones v3–v38 sobre `PRAGMA user_version`
    db/seed.ts                Datos de demostración y primer administrador
    repo.ts                   Fachada del repositorio (`export *` de `repo/`)
    repo/shared.ts            Helpers SQL comunes: visibilidad, bloqueos, distancias, selects
    repo/users.ts             Cuentas, sesiones, intentos de acceso y perfil
    repo/catalog.ts           Catálogo, ejemplares, obras y sitemap
    repo/requests.ts          Solicitudes y mensajes
    repo/comments.ts          Hilo de la obra, spoilers, me gusta y conversaciones
    repo/social.ts            Seguimiento, directorio y muros de actividad
    repo/profile.ts           Perfil público y sus métricas
    repo/lists.ts             Listas de lectura
    repo/clubs.ts             Clubs por ciudad
    repo/clubforum.ts         Foro del club (solo miembros): mensajes, respuestas y avisos
    repo/clubpolls.ts         Votación de la próxima lectura
    repo/reading.ts           Estados «leyendo» / «leído» por obra
    repo/reviews.ts           Valoraciones de intercambios
    repo/moderation.ts        Denuncias, sanciones y auditoría
    repo/account.ts           Exportación y borrado de cuenta
    repo/journey.ts           Recorrido e insignias del lector
    repo/stats.ts             Actividad y cifras públicas
    repo/wants.ts             Avisos por obra («avísame si aparece en mi ciudad»)
    repo/snapshots.ts         Composición del snapshot de la portada
    repo/maintenance.ts       Caducidad y purgas
    repo/totp.ts              Estado y verificación del segundo factor
    request-flow.ts           Transiciones de estado puras
    auth.ts                   Sesiones en cookie httpOnly y roles
    password.ts               scrypt asíncrono con sal por usuario y hash señuelo
    totp.ts                   TOTP RFC 6238 (base32, HMAC-SHA1, anti-replay)
    captcha.ts                Turnstile opcional + honeypot y tiempo mínimo
    observability.ts          Errores, id de petición y línea de latencia por petición
    throttle.ts               Límites por cuota, IP de confianza y guardia de origen
    page-throttle.ts          Limitador de páginas públicas (no rompe la página, devuelve bool)
    api.ts / errors.ts        Respuestas JSON uniformes y `Retry-After`
    route.ts                  Envoltorio de rutas: sesión, cuerpo validado, cuota y errores
    validation.ts             Esquemas Zod
    e2e.ts                    Cifrado de extremo a extremo (ECDH + HKDF + AES-GCM)
tests/
  text, request-flow, repo, security, contracts, env-check, route, schema,
  observability y suites v4–v42 (45 ficheros, 327 pruebas)
e2e/
  app.spec.ts               Playwright: catálogo/búsqueda, tema, acceso, cuenta,
                            vista previa, guards y SEO
  api.spec.ts               Playwright contra los route handlers (415, CSRF, 401,
                            403, 422 con formato de errores)
playwright.config.ts        Servidor propio en localhost:3100 (o PLAYWRIGHT_BASE_URL)
deploy/                     systemd, nginx, plantilla de entorno y guía de despliegue
Dockerfile, docker-compose.yml
```

### Renderizado y límites de cliente
El armazón (`site-shell.tsx`, `site-rail.tsx`) es **Server Component**: la barra lateral, la cabecera, el pie y la navegación móvil llegan ya pintados y solo se hidratan las islas que de verdad son interactivas (`account-menu`, `theme-toggle`, `locale-switcher`, `verify-email-banner`). Antes el armazón entero era de cliente y cada página pagaba su hidratación.

El **diccionario alemán no viaja al navegador**: `i18n.ts` (con `translate()`) solo se importa en el servidor y el layout pasa al proveedor de cliente únicamente los textos del idioma activo (`de` o nada). Así el JS de cliente baja de ~1,2 MB a ~1,1 MB y deja de incluir un chunk de 68 KB que también descargaba quien lee en español. El idioma vive en `locale.ts`, sin diccionario, para que los componentes de cliente puedan usar el tipo sin arrastrarlo.

### Acceso a datos
`getDb()` intercepta `prepare` para **reutilizar sentencias compiladas** (caché FIFO de 400 por conexión): `prepare()` cuesta ~13 µs y `catalogPage` pasa de 0,284 ms a 0,127 ms por consulta. No hay que cambiar ninguna llamada del repo. Los agregados públicos se cachean con `use cache` + `cacheTag("public-data")` y se invalidan desde las rutas que mutan.

### Datos
- `books` (edición, ISBN único) separado de `listings` (ejemplar concreto).
- Estados de ejemplar: `available`, `reserved`, `given`, `paused`, `removed`.
- Estados de solicitud: `pending`, `accepted`, `declined`, `cancelled`, `completed`, `expired`.
- **Migraciones versionadas** con `PRAGMA user_version` (actual: v38); las bases creadas con un esquema anterior se actualizan conservando los datos. La v12 permite una valoración por persona e intercambio (antes solo la primera parte podía valorar) y guarda el estado previo de un ejemplar retirado por moderación; la v13 añade el secreto TOTP y el último paso consumido para la verificación en dos pasos; la v14 añade el **punto de entrega** en una oficina de Deutsche Post (`requests.handover_office_id`) y el **sobre cifrado** de los mensajes (`messages.ciphertext`, `iv`, `encrypted`) junto con la clave pública de cada cuenta (`users.public_key`); la v15 añade `availability_alerts` para los avisos de novedad por ciudad; la v16 añade `users.public_key_id` (huella SHA-256 de la clave), `messages.key_id` y la bandeja `mail_outbox`; la v17 añade `users.email_notifications` para la preferencia de avisos por correo; la v18 añade `requests.owner_confirmed_at` y `requests.requester_confirmed_at` para el **cierre bilateral** del intercambio; la v19 añade a los clubs el **próximo encuentro** (`meets_at`), el estado de moderación, la política de entrada, el progreso de lectura, la asistencia (`club_attendance`), las solicitudes pendientes (`club_members.status`) y la tabla de métricas `product_events`; la v20 añade `users.locale` y sustituye las ciudades de Baden-Württemberg por las **123 ciudades de toda Alemania**, recalculando la matriz de distancias; la v21 reduce los géneros antiguos a las **cinco categorías principales** actuales; la v22 añade `book_wants` para los avisos por obra y ciudad; la v23 añade `books.language`, `reading_states` y `requests.handover_code`; la v24 completa el idioma de las ediciones de demostración; la v25 añade `club_loans` para la rotación de ejemplares dentro de un club; la v26 añade índices para las consultas más frecuentes (ejemplares por obra, correo pendiente, auditoría por objetivo, denuncias y mensajes por remitente); la v27 normaliza a las cinco categorías actuales los libros que conservaban un género heredado; la v28 añade `public_key_history` para auditar los cambios de clave de cifrado; … la v32 añade el **foro de cada club** (`club_posts` y `club_post_likes`), que sustituye a la conversación prestada del libro en curso por un tablón privado de los miembros; la v33 añade el **sitio del encuentro** y su enlace (`clubs.meets_place`, `clubs.meets_link`) y las **votaciones de la próxima lectura** (`club_polls`, `club_poll_options`, `club_poll_votes`); la v34 añade `club_members.role` para los **moderadores** de un club; la **v35 restringe la plataforma a Baden-Württemberg**: el catálogo de ciudades vuelve a ser el de la región (103 municipios) y la matriz de distancias se recalcula solo con ellas. La v36 añade la **mensajería directa cifrada** entre seguidores mutuos (`dm_threads`, `dm_messages`, `dm_reads`) y la v37 la **entrega por correo**: `requests.handover_method` y las columnas `ship_*`; la **v38 vuelve a abrir el catálogo a toda Alemania** (123 municipios) y **retira las oficinas de Deutsche Post**: el envío va a una Packstation o a la dirección de quien recibe, `requests.ship_kind` distingue las dos formas, `ship_street` guarda la calle y **todos los campos del envío se cifran** con `APP_ENCRYPTION_KEY` (también los que la v37 guardó en claro).
- **Envío sin direcciones públicas (`handover_method = 'post'`)**: el libro viaja como **Warensendung**
  a donde diga **quien lo recibe**, con dos opciones y la misma garantía en las dos: una **Packstation**
  de DHL (número de cliente o Postnummer + taquilla) o **su propia dirección** (`requests.ship_kind`
  distingue `packstation` y `address`). Todos los campos (`ship_number`, `ship_station`,
  `ship_street`, `ship_postal_code`, `ship_city`) se guardan **cifrados con `APP_ENCRYPTION_KEY`**, cada
  uno atado a su solicitud y a su columna (AAD), así que un criptograma movido a otra fila no se puede abrir
  (`secret-box.ts`, el mismo mecanismo que el secreto TOTP) y solo se descifran en la vista de las dos
  partes del intercambio. Con eso la etiqueta se compone en el navegador (nombre, Postnummer y
  «Packstation 123» o la calle, más CP y ciudad) y el remitente firma con su nombre, sin calle ni código
  postal. Los avisos de la campana **no repiten el destino**: solo dicen que ya se puede enviar. El código
  de entrega de 6 cifras **se imprime y se mete dentro del libro** (`print.ts` clona la tarjeta en un
  iframe oculto, sin abrir ventanas ni interpolar HTML); quien lo recibe lo introduce al abrirlo.
- **Entrega en mano**: si las dos partes quedan, no hay ningún dato que guardar. La ficha del intercambio
  solo recuerda que el sitio se acuerda en la conversación; la plataforma no pide ni guarda direcciones.
- Búsqueda con **FTS5** (`listings_fts`, contenido externo sobre `listings.search_key`): los disparadores la mantienen al día y admite prefijos y acentos.
- `request_reads` guarda hasta cuándo ha leído cada persona su conversación, para el contador de mensajes sin leer.
- **Capa social**: los comentarios cuelgan de la **obra** (`books`), no del ejemplar, así que la conversación de un título se comparte entre todas sus copias y sobrevive a que el libro cambie de manos. `book_comments` guarda `parent_id` (un solo nivel de respuestas), `spoiler` y `status` (`visible`/`hidden`/`deleted`); `book_comment_likes` la reacción. Los avisos de respuesta usan un tipo propio (`comment`) con `book_id`, y denunciar un comentario es un objetivo más de `reports` (`comment`). Las **incidencias de intercambio** se guardan como `reports` con `target_type = 'request'`; solo pueden abrirlas las dos partes y exigen una descripción para la moderación.
- **Jerarquía del hub de comunidad**: el título de la página, después **las cinco secciones** (pestañas)
  y solo entonces la descripción del muro con sus filtros y la lista. Antes las pestañas vivían dentro de
  la tarjeta del muro y por encima de ellas había un encabezado que repetía el nombre de la pestaña
  activa: dos niveles de navegación compitiendo. La banda «La comunidad en cifras» y el buscador propio
  de las pestañas de clubes, lectores y listas **se retiraron**: las cifras viven en la portada
  (`hero-stats`, cuatro: ejemplares, intercambios, lectores y **clubes de lectura**) y el buscador es
  el de la cabecera, que ya cubre esas tres secciones.
- **Grafo social**: `follows` (seguidor → seguido) alimenta el muro «Siguiendo» de la comunidad y los contadores del perfil. Los bloqueos cortan el seguimiento en ambos sentidos y las cuentas suspendidas no aparecen ni en el directorio ni en los muros.
- **Descubrimiento**: cada obra tiene una de las cinco **categorías principales** (`CATEGORIES`/`CATEGORY_DESCRIPTIONS` en `domain.ts`: Humanidades, Ciencias y técnica, Sociedad y política, Biografías y Ficción), con descripción visible al filtrar; `listing_tags` guarda hasta 3 **etiquetas temáticas** (`TAGS` en `domain.ts`: Historia, Filosofía, Física, Sociología, Narrativa…) por ejemplar, que se filtran con `?tag=`. Las etiquetas describen el área de conocimiento, no el escaparate: se retiraron «Novela negra», «Romántica», «Actualidad», «Memorias», «Firmado», «Primera edición», «Infantil», «Juvenil», «Viajes», «Manual», «Autoayuda» y «Cómic». El formulario propone solo las del género elegido (`TAGS_BY_CATEGORY`) y el servidor descarta cualquier etiqueta que no esté en `TAGS`. El catálogo ordena por distancia y permite **limitar por radio** (`?radius=10|25|50|100`, 0 = toda la región) y **filtrar por idioma** (`?language=Español`). La ficha de la obra añade **recomendaciones locales** (misma categoría o etiquetas en común, sin llamadas externas), un aviso **«avísame de nuevos ejemplares»** por obra, un contador de demanda en la ciudad y los estados **«leyendo» / «leído»**. `reading_lists` + `reading_list_items` son listas de obra (públicas y editables solo por su dueño). `clubs` + `club_members` son clubs por ciudad con lectura en curso; su ficha muestra los ejemplares disponibles en la ciudad y **dónde se ve el club** (`meets_place`, `meets_link`). Desde la v32 cada club tiene **su propio foro** (`club_posts`, `club_post_likes`): un tablón que solo leen sus miembros, con un nivel de respuestas y «me gusta», y sin mensajes privados. La v33 añade la **votación de la próxima lectura** (dos a cinco obras, un voto por persona y se puede cambiar) y el club se elige del **catálogo entero**, no solo de los libros que tenga publicados quien lo creó. El hilo de la obra sigue existiendo y es público: el club puede llevar allí lo que quiera compartir con toda la plataforma.
- **El ISBN es obligatorio y rellena la ficha**: `listingSchema` exige un ISBN-10/ISBN-13 con **dígito de control correcto** (`isValidIsbn`), así que un dígito mal tecleado se detecta al publicar en vez de romper la portada. Se escribe a mano (sin cámara) y **el título y la autoría no se teclean**: los pone el ISBN. `GET /api/isbn/<isbn>` consulta en paralelo la **DNB** (Deutsche Nationalbibliothek, SRU: es la única fuente que conoce los libros publicados en Alemania) y **Open Library** (ediciones internacionales, temas y el id de obra `/works/OL…W`), y de ahí salen también el **idioma**, el **género** y hasta tres **etiquetas**. La DNB manda en título, autoría e idioma; si clasifica, su DDC decide el género (`isbn-metadata.ts`). Solo si ningún catálogo conoce la edición se dejan escribir a mano, avisando de que quedan sin verificar.
- **El panel lateral es de quien ha entrado**: sin sesión no se pinta (ni la barra inferior del móvil),
  porque todo lo que contiene pide cuenta. La portada pública se queda con su héroe, sus cifras y la fila
  de libros, y el acceso está en la cabecera. Dentro del menú, **Descubrir y Ofrecer un libro** llevan el
  mismo candado que estantería, intercambios y comunidad cuando no hay usuario.
- **«Ofrecer un libro» es una página** (`/ofrecer`), no una ventana emergente: tiene URL, se puede
  recargar y compartir, y al publicar lleva a la estantería. El formulario (`offer-form.tsx`) es el mismo
  que tenía el diálogo, sin el envoltorio.
- **El formulario de oferta se lee en dos bloques**: «El libro» (ISBN y los datos que trae la ficha, en
  una columna) y «Tu ejemplar» (estado, ciudad y etiquetas), cada uno con su título y su línea; el botón
  de publicar vive en una barra al pie, a la derecha, con el aviso legal a la izquierda. Antes era una
  lista de campos seguidos en la que no se distinguía lo que rellena el ISBN de lo que decides tú. En
  pantallas estrechas los bloques se apilan en ese mismo orden.
- **«Ofrecer un libro» en el menú**: una entrada más del panel lateral, con el mismo estilo que el resto y
  colocada **justo debajo de «Descubrir»** (las dos acciones principales van juntas). Antes era un botón
  verde aparte, pegado al pie del panel.
- **«Explorar libros» sin sesión**: el botón del hero abre la ventana de acceso/registro en vez de
  navegar. Antes navegaba a `/descubrir` y el servidor, al ver que era una vista privada, redirigía a
  `/?auth=1&next=…` —pero la app ya montada no recalculaba su estado inicial, así que el redirect
  ocurría en silencio y no aparecía ninguna ventana. Ahora se pregunta antes de navegar (`requireAuth`)
  y, si la `?auth=1` llega en una navegación de cliente, el estado se ajusta durante el render.
- **Una sola familia de controles en los filtros**: en Descubrir y en Mi estantería el campo de
  búsqueda, el selector de orden (más cercanos, más recientes…), los filtros de distancia y el selector
  de idioma comparten altura, borde, radio y color de superficie (`.search-field`, `.sort-select`,
  `.filter-chip`, `.language-filter select`). Antes cada control venía de un sitio distinto y la barra
  parecía tres barras pegadas; los filtros secundarios (distancia e idioma) van en una segunda línea
  alineada.
- **Buscador global**: la cabecera lleva un campo de búsqueda en todas las páginas (`SiteSearch` → `/buscar?q=`). Es un formulario GET normal —funciona sin JavaScript y la búsqueda queda en la URL— y junta obras, clubes, lectores y listas, cada uno con su enlace a la sección para seguir afinando. Las búsquedas son **insensibles a las tildes**: `unaccent()` (función registrada en la conexión SQLite) pliega «Lucía» a «lucia», porque `COLLATE NOCASE` solo cubre ASCII y buscar sin tildes no encontraba a media comunidad.
- **La administración se distingue de la cuenta**: la barra lateral tiene una entrada propia,
  **Moderación** (solo para quien tiene el rol), y `/admin` se titula «Moderación de la comunidad» con su
  descripción —denuncias, sanciones y contenido oculto—, no con los datos personales de la cuenta. Antes
  no había entrada en el menú y la página de administración solo se alcanzaba escribiendo la URL, así
  que la vista de moderación y la de cuenta se parecían demasiado. Cuando falta el segundo factor, la
  puerta lo dice con un escudo, un título propio («Falta un paso: verificación en dos pasos») y los tres
  pasos para activarlo, en vez de parecer un ajuste más de la cuenta.
- **Moderadores**: quien crea un club puede nombrar gente de confianza (`club_members.role = 'moderator'`, v34) para **aceptar o rechazar solicitudes** y **retirar mensajes del foro**; el dueño recibe el aviso cada vez que un moderador decide quién entra. Lo que no se delega es el club: editarlo, cerrarlo, cederlo y retirar a un miembro siguen siendo exclusivos de su dueño, y el permiso se comprueba en la base en cada petición (un moderador retirado pierde el acceso en el acto).
- **Moderación del club**: quien lo lleva (dueño y moderadores) ve en la propia ficha los **mensajes denunciados** del foro —texto, autor, quién denunció, motivo y fecha— y puede borrarlos desde ahí; al borrar, la denuncia queda cerrada (`status = 'resolved'`), así que el panel de administración no sigue enseñando denuncias de mensajes que ya no existen. Antes esa información solo la veía la administración y para el club la moderación «no existía».
- **Ficha del club**: las acciones de quien lo dirige viven **arriba y en un solo sitio** (compartir, copiar enlace, gestionar miembros y editar), no al pie de la página; editar abre un diálogo con todos los ajustes y la **zona de peligro** dentro, así que cerrar el club ya no es un botón suelto al lado de «Editar» sino un segundo paso dentro de la edición. Quien creó el club ve una insignia en lugar del botón de unirse (antes lo pulsaba y recibía un `409`), salir pide confirmación porque se pierde el foro, y las **solicitudes de entrada** aparecen en una banda destacada sobre las fichas: son una acción pendiente, no una tercera columna que haya que ir a buscar. La **lista de miembros no se envía** a quien no está en el club (el servidor ni siquiera la consulta): fuera del club solo se ve el número.
- **Foro del club**: cada club tiene un tablón privado. La pertenencia se comprueba en la base
  (`club_members.status = 'member'`, más quien lo creó), no en el cliente: un `GET` sin sesión
  devuelve 401 y desde fuera del club, 403. Se responde un solo nivel, como en el hilo de una obra.
  Borra quien lo escribió, quien creó el club (es el moderador de su tablón) y la administración
  —con auditoría—; si el mensaje ya tiene respuestas se conserva el hueco, no el texto. Los
  mensajes ocultos por moderación solo los ve su autor y los de cuentas suspendidas no aparecen.
  Los avisos están topados: responder avisa solo a quien escribió el mensaje, y un mensaje nuevo
  avisa al club **como mucho una vez cada 20 h por persona** (`product_events`), para que un
  tablón activo no se convierta en una máquina de notificaciones.

- **Agrupación de ediciones**: cada ISBN es una edición, pero el libro es uno. `books.work_key` (migración v31) guarda la obra: `ol:<workId>` cuando Open Library la conoce —agrupa incluso traducciones— o `t:<hash>` derivado del título (sin subtítulo) y del apellido de la autoría. Ejemplares y comentarios se leen **por obra**, así que dos ediciones comparten conversación y lista de copias, `/obra/<id>` canoniza a la primera edición y el formulario avisa («ya hay una edición de esta obra en el catálogo») antes de publicar la segunda.
- **Recorrido**: las cifras del perfil (libros pasados/recibidos, kilómetros entre ciudades de los intercambios cerrados, ciudades, listas, clubs) y las **insignias** se derivan al vuelo con `getReaderJourney()`. No hay contadores guardados que se puedan desincronizar ni tablas nuevas que mantener.
- **Avisos de novedad por ciudad**: `availability_alerts` (persona + ciudad) hace que al publicar un ejemplar nuevo se cree un aviso interno para quien sigue esa ciudad, excluyendo a quien publica, a las cuentas suspendidas y a los bloqueos. Se activan o desactivan desde **Perfil → Editar perfil → Avisarme de nuevos libros** (`POST /api/alerts/availability`) y disparan un aviso interno (y un correo si la preferencia está activa).
- **Toda Alemania.** `cities` guarda las coordenadas de **123 municipios de Alemania** y
  `city_distances` la matriz de distancias (haversine precalculado). Ni el registro, ni la oferta, ni el
  club, ni el perfil aceptan una ciudad fuera de la lista: el mensaje es «Elige una ciudad de Alemania».
  El catálogo ordena y muestra la distancia desde la ciudad de quien mira; sin ciudad conocida no se
  inventa ninguna cifra. Solo se guarda la ciudad, nunca la dirección ni el distrito (los del envío van
  cifrados, aparte, y solo los ve la pareja del intercambio).
- `account_tokens` guarda (hasheados) los tokens de verificación y recuperación, de un solo uso y con caducidad.
- Índices para sesiones, solicitudes, listados por dueño/estado, avisos y búsqueda.

### Invariantes garantizadas en servidor

Intercambios: el cierre es **bilateral**. Cada parte confirma la entrega por separado (`owner_confirmed_at` / `requester_confirmed_at`); la primera confirmación deja la solicitud en `accepted` y avisa a la otra, y solo cuando existen las dos pasa a `completed` y el ejemplar a `given`. Así una persona no puede cerrar el intercambio (ni habilitar reseñas) por las dos.

Cuentas y administración: las sesiones caducan de forma absoluta a los 30 días (la renovación deslizante no puede superarlos), el correo debe estar verificado para publicar y solicitar en producción, y **el panel de administración exige TOTP activo en producción**; sin él la cuenta administradora no puede moderar aunque tenga el rol (la página lo explica y ofrece el camino, en vez de responder «no existe»). Los secretos TOTP se guardan cifrados con `APP_ENCRYPTION_KEY`.

Seguimiento: no se puede seguir a uno mismo, ni a una cuenta bloqueada o suspendida; los contadores excluyen cuentas inactivas. Listas y clubs: solo su dueño los edita, máximo 30 listas y 60 obras por lista, y quien creó un club no puede salir de él.

Clubs: máximo 10 por cuenta, 200 miembros por club y **nombre único dentro de su ciudad** (comparado sin mayúsculas ni espacios sobrantes, también al renombrar); así el directorio no se puede inundar de clubes duplicados. La entrada puede ser **abierta o con aprobación**: una solicitud pendiente no cuenta como miembro ni permite comentar como club hasta que quien lo creó la acepta. Solo el dueño puede retirar miembros, ceder el club a otro miembro o cerrarlo; el club también es un objetivo denunciable y la moderación puede ocultarlo y restablecerlo.

**Comunidad con pestañas en la URL**: el panel principal ofrece Conversaciones, Actividad, Clubes, Lectores y Listas, y el ámbito (región o ciudad) viaja en `?tab=` y `?scope=`. “Crear club” vive dentro de la pestaña Clubes y el botón de navegación sigue presente en el pie; la barra lateral ya no repite enlaces a Clubes, Lectores y Listas. Cada club puede fijar un **próximo encuentro con fecha** (además de la cadencia libre), confirmar asistencia, marcar el **progreso de lectura** y compartirse por enlace o invitar a alguien a quien sigues. El cron de mantenimiento envía un recordatorio interno el día antes del encuentro, una sola vez por reunión, y cualquier cambio de lectura, fecha o progreso avisa a los miembros.

Comentarios: solo sobre obras existentes, un único nivel de respuestas, `body` de 2 a 800 caracteres, autor activo, bloqueos cruzados filtrados **en SQL** (`NOT EXISTS` sobre `blocks`), comentarios de cuentas suspendidas fuera del hilo, ocultos visibles solo para su autor y moderación reversible (`hide_comment`/`restore_comment` con auditoría), *rate limit* de 60 comentarios/hora por cuenta. El **texto de un comentario con spoiler no viaja en el hilo**: se pide a `/api/comments/[id]/body` al revelarlo, así que no aparece en el código fuente de la página.

Privacidad: `GET /api/account/export` incluye comentarios, reacciones, seguidores/seguidos, listas, clubs y **mensajes enviados y recibidos** (los cifrados, como sobre `ciphertext` + `iv`); borrar la cuenta elimina ese contenido (los comentarios con respuestas quedan como hueco marcado para no romper los hilos) y corta `follows`, `blocks`, `club_members`, `reading_lists`, los clubs propios, avisos y tokens de cuenta. Los mensajes ya enviados se conservan para no romper las conversaciones de la otra parte; la política de privacidad debe reflejarlo.

### Mensajería de extremo a extremo

El servidor **no puede leer las conversaciones** nuevas: no guarda la clave privada ni el texto plano.

1. Al iniciar sesión, el navegador genera un par **ECDH P-256**. La clave privada se guarda como `CryptoKey` **no extraíble** en IndexedDB (`wanderbibliothek-e2e`); solo la mitad pública se envía a `PUT /api/account/keys` junto con su huella SHA-256 (`keyId`). El servidor valida que sea un punto real de P-256. **La primera clave se publica sola**, sin pedir permiso: al entrar (en el armazón del catálogo) y también al abrir `/cuenta`, así que el cifrado no depende de que alguien pulse un botón. Sustituir una clave existente sí exige la contraseña, porque invalida la del otro dispositivo.
2. Para cada conversación se deriva una clave **AES-GCM-256** con ECDH + HKDF-SHA256, usando el identificador de la solicitud como `info` (dos hilos nunca comparten clave).
3. El mensaje se cifra en el cliente con **AAD** `requestId + remitente + keyId` y se envía como `{ ciphertext, iv, keyId }`; el servidor guarda el sobre y la huella. Un mensaje no se puede mover a otro hilo, remitente o clave.
4. La primera huella de la otra persona se recuerda (TOFU). Si cambia, la interfaz muestra la huella nueva y **bloquea el envío** hasta confirmarla; la cuenta recibe además un aviso interno de cambio de clave.
5. Si cualquiera de las dos cuentas tiene clave publicada, el servidor **rechaza el texto plano** (409): no se puede degradar el cifrado. Los mensajes anteriores a la v14 siguen visibles etiquetados como «sin cifrar (histórico)».
6. Los avisos de mensaje nuevo no incluyen el contenido y la moderación solo ve «mensaje cifrado»; denunciar un mensaje exige una descripción de quien denuncia.
7. La primera solicitud **ya no guarda un mensaje en claro**: se coordina todo en el hilo cifrado.

La conversación se actualiza **en vivo** con Server-Sent Events (`/api/requests/[id]/events`): el servidor solo compara la huella del último mensaje y avisa de que hay novedades; el contenido se vuelve a pedir y se descifra en el cliente. La señal llega por un bus interno en memoria (`src/lib/live.ts`) en cuanto se guarda un mensaje y, como red de seguridad, se revisa la huella cada pocos segundos; al consultar la base de datos (y no una memoria local) el canal sigue siendo correcto si el proceso se reinicia o si el mensaje llega por otra vía. Para varias instancias haría falta Redis/pubsub.

#### Mensajes directos entre lectores

Además del hilo de cada intercambio, dos personas que **se siguen mutuamente** pueden hablar en privado:

- `GET /api/direct/<id>` devuelve el hilo con esa persona y el motivo por el que se puede (o no) escribir (`ok`, `mutual`, `blocked`, `no-key`); `POST` guarda un mensaje cifrado y `POST /api/direct/<id>/read` marca la conversación como leída.
- La clave de la conversación se deriva del **par de identificadores ordenado** (`dm:<a>:<b>`), no de una fila de la base: así se puede cifrar el primer mensaje antes de que exista el hilo. El `AAD` incluye la conversación, el remitente y la huella, igual que en los intercambios.
- Requisitos: seguimiento mutuo, ninguna de las dos partes bloqueada, y clave publicada por las dos. El servidor comprueba que el `keyId` del sobre es el de quien envía y **solo acepta sobres** (nunca texto plano).
- La interfaz abre el diálogo desde el perfil («Mensaje») o desde el aviso (`/u/<id>?dm=1`), descifra en el navegador y avisa con un bloque explicativo cuando falta la clave de la otra persona o cuando este navegador tiene una clave distinta a la publicada (eso último solo se arregla publicando la clave desde `Mi cuenta`, porque el cambio pide contraseña).
- Un aviso por conversación y **como mucho cada 30 minutos** (`notifications.link`): un hilo activo no se convierte en una máquina de notificaciones. Borrar la cuenta se lleva hilos, mensajes y marcas de lectura.

Limitaciones conocidas y deliberadas: la clave vive en el dispositivo, así que borrar los datos del navegador o cambiar de dispositivo impide descifrar el historial (nadie más puede hacerlo); si una persona pierde su clave, los mensajes nuevos dejan de ser legibles para ella y hay que volver a publicar una clave desde el dispositivo donde use la cuenta. No hay recuperación de clave por parte de la plataforma, ni la habrá: sería una puerta trasera.

El **mapa de Bücherschränke** sigue pendiente de una fuente de coordenadas verificada (OSM o acuerdos con bibliotecas/espacios públicos). No se muestran puntos inventados ni se consulta un servicio externo sin caché; por eso esta entrega prioriza préstamo, QR e idioma antes que el mapa.

- Un ejemplar solo se reserva si sigue `available` (`UPDATE ... WHERE status = 'available'` dentro de transacción).
- Al aceptar, las solicitudes rivales pasan a `expired`.
- Un índice único parcial impide dos solicitudes pendientes de la misma persona al mismo ejemplar.
- Solo el dueño acepta/rechaza; quien solicita puede cancelar; completar exige un intercambio aceptado.
- No se puede solicitar ni escribir a alguien con quien existe un bloqueo.
- Los datos de la Packstation los escribe **solo quien recibe** el libro y solo con el intercambio
  aceptado; quien envía los ve en la etiqueta pero no puede cambiarlos.
- Con envío por correo el código de entrega no se enseña en pantalla: se imprime y viaja dentro del libro.
- Retirar un ejemplar expira sus solicitudes pendientes.
- Las solicitudes sin respuesta caducan a los 14 días (`expireStaleRequests`) y avisan a quien esperaba.
- Cada acontecimiento (solicitud, aceptación, rechazo, mensaje, valoración) genera un aviso para la otra parte.
- Una valoración solo existe si el intercambio está `completed` y **cada parte puede dejar la suya** (una por persona).
- Una cuenta suspendida deja de exponer perfil, ejemplares y actividad, y no puede iniciar sesión.
- La moderación es reversible: suspender no borra los ejemplares (solo se ocultan) y `restore_listing` devuelve a la vida un ejemplar retirado. Todo queda en `admin_audit`.
- Los mensajes de una conversación cuentan como no leídos hasta que la otra persona la abre.

### Seguridad

- Contraseñas con `scrypt` asíncrono (no bloquea el bucle de eventos) y sal única; nunca se devuelve el hash.
- El login verifica siempre un hash (contra un señuelo si la cuenta no existe), así que el tiempo de respuesta no revela qué correos están registrados.
- Token de sesión de 256 bits en cookie `httpOnly` + `SameSite=Lax`; solo su SHA-256 en base de datos. En producción **solo** se acepta la cookie con prefijo `__Host-` (una cookie de subdominio no puede fijar la sesión).
- **Verificación en dos pasos (TOTP)** opcional por cuenta: 6 dígitos, ventana de ±1 paso, anti-replay por `totp_last_step`. Activarla o desactivarla exige la contraseña; el login pide el código después de validar la contraseña. Recuperación de emergencia: `npm run admin:2fa-off -- <email>`.
- **Registro**: honeypot + tiempo mínimo y, si hay claves, Cloudflare Turnstile validado en servidor.
- Cambiar la contraseña revoca todas las sesiones y renueva la del dispositivo actual.
- Límites por cuota en base de datos (`throttle`, transacción atómica): por IP y por cuenta para acceso, recuperación y restablecimiento, y globales altas para no bloquear el servicio completo bajo un pico (5000/min en acceso, 2000/h en registro y recuperación, 1000/h en restablecimiento). Publicar 10/día, solicitar 20/día, mensajes 120/h, denuncias 5/día, exportar 5/h. Respuesta `429` con `Retry-After`.
- Los intentos fallidos de acceso no bloquean a quien acierta la contraseña: un tercero no puede dejar fuera al titular de una cuenta.
- Todas las mutaciones pasan por `guard()` (origen + cuota) y `readJson()` exige `Content-Type: application/json`, lo que bloquea los formularios cross-site.
- `readJson()` corta los cuerpos de más de 64 KB (413) y las respuestas JSON van con `Cache-Control: no-store`.
- Guardia de origen: se rechazan mutaciones con `Origin` ajeno o con `Sec-Fetch-Site` de otro sitio.
- CSP con nonce por petición (`strict-dynamic`), `X-Frame-Options: DENY`, COOP/CORP `same-origin`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (cámara solo para el propio origen, para el escáner de ISBN; micrófono y geolocalización bloqueados) y HSTS en producción (`src/proxy.ts`, convención `proxy` de Next 16).
- La base se crea con permisos `0700` (directorio) y `0600` (fichero).
- **Los datos de demostración nunca se siembran en producción** (`SEED_DEMO=1` lo fuerza); el primer administrador se crea con `ADMIN_EMAIL`/`ADMIN_PASSWORD` o con `npm run admin:create`.
- Sesiones: máximo 10 por cuenta y renovación deslizante (si queda menos de una semana se alargan a 14 días).
- Los pases de estado de un ejemplar se comprueban dentro del `UPDATE` (sin ventana entre lectura y escritura).
- Registro con mensaje genérico para no revelar correos registrados; los errores de control de Next no se convierten en `500`.
- Consultas parametrizadas y validación Zod en todas las entradas; exportación y borrado de cuenta con contraseña y confirmación explícita.
- Contraseñas de 10+ caracteres con lista de contraseñas habituales prohibida, tanto al registrarse como al cambiarla.
- Verificación de correo y recuperación de contraseña con tokens de un solo uso (24 h y 1 h), respuesta idéntica exista o no el correo, y cierre de todas las sesiones al restablecer.
- Los ejemplares pausados dejan de ser públicos y los de cuentas suspendidas no se pueden solicitar ni guardar, aunque se conozca su identificador.
- **La barra inferior móvil** usa etiquetas cortas («Cambios» para Intercambios) y `white-space: normal`: cinco destinos caben a 10,5 px desde 320 px sin cortar palabras ni recurrir a 9,5 px. El botón central conserva su círculo pero **también dice qué hace** («Ofrecer»), porque un «+» sin etiqueta no explica la acción principal.

### Accesibilidad y diseño

- Contraste mínimo AA en textos, escala tipográfica desde 12 px y objetivos táctiles de 44 px en móvil.
- Diálogos con foco atrapado, cierre con `Escape` y restauración del foco.
- Enlace «Saltar al contenido», `aria-current` en navegación, filtros con `aria-pressed`, errores anunciados con `role="alert"`.
- El botón de avisos muestra un **contador numérico** (`9+` cuando hay más de nueve) y anuncia el total con `aria-label`; los no leídos se distinguen con color, borde y peso, no solo con el color. El menú de cuenta enlaza a la bandeja desde cualquier página y cada aviso enlaza a la obra o al perfil que lo provocó.
- **Modo oscuro** automático (`prefers-color-scheme`) y con conmutador manual (`data-theme` + `localStorage`), construido sobre una capa de tokens (`--paper`, `--surface`, `--line`, `--ink`…): no hay colores literales en los componentes, así que el tema claro y el oscuro comparten el mismo marcado.
- Las insignias del recorrido llevan rótulo y pista de texto (no solo icono y color) y las pestañas del perfil y de la comunidad se anuncian con `aria-current`.
- Layout verificado de 320 a 1920 px, con `prefers-reduced-motion`.

## Pruebas

`npm test` ejecuta **327 pruebas** unitarias/de integración en **45 ficheros** y `npm run test:e2e` añade **34 pruebas** de navegador con Playwright: catálogo y búsqueda, tema, acceso, vista previa con retorno a la ficha, guards de páginas internas y salud/SEO. Las suites cubren normalización de búsqueda e ISBN, reglas de transición, integración del repositorio sobre SQLite en memoria, seguridad (origen, `clientIp`, cuotas, host reenviado), v4 (FTS5, mensajes sin leer, moderación reversible, purgas), v5 (perfil editable, exportación completa, avisos individuales, paginación por cursor, denuncia de reseñas), v6 (distancias por ciudad, ejemplar pausado, suspensión coherente, tokens de cuenta), v7 (ciudades de la región y validación de la lista cerrada), v8 (hilos de comentarios, paginación por cursor, me gusta, borrado con hueco, moderación reversible, bloqueos y avisos), v9 (seguir, muro «Siguiendo», directorio y muro del perfil), v10 (etiquetas curadas y filtro, listas de lectura y clubs por ciudad), v11 (recorrido del lector e insignias), v12 (bloqueos en listas y clubs, exportación y borrado de la capa social, seguidores/seguidos, spoilers fuera del HTML, edición de listas y clubs), v13 (límites de clubs y avisos con libro desaparecido) v14 (reseñas de ambas partes, spoilers fuera del muro, totales coherentes, bloqueos que cortan seguimientos, moderación reversible con estado previo, borrado completo de cuenta, nombres reservados, tope de cuerpo y tokens de un solo uso), v15 (TOTP contra el vector de la RFC 6238, migración v13, activación/verificación/desactivación y anti-replay), v16 (datos de envío sin texto plano en la base, mensajes cifrados sin texto plano, huellas de clave y AAD, TOTP cifrado, avisos sin contenido, rechazo de texto plano, moderación sin acceso al mensaje, avisos de novedad por ciudad, borrado completo de secretos y outbox de correo), el cierre bilateral de la v18 (primera confirmación deja `accepted`, la segunda completa) y la v19 (encuentros con fecha, aprobación de entrada, asistencia, progreso, cesión y retirada de miembros, invitaciones, listas públicas, cercanía y obras en común en el directorio, denuncia y moderación de clubs, recordatorios y métricas), la v20 (idioma por cuenta y, entonces, ciudades de toda Alemania), la v21 (cinco categorías principales y migración de los géneros antiguos), la v22 (avisos guardados en el idioma de quien los recibe), la v23 (incidencias de intercambio y métricas de embudo), la v24 (recomendaciones por categoría y etiquetas, sin duplicados ni el libro actual) y la v25 (radio de distancia y avisos por obra), la v26 (idioma, estados de lectura y código de entrega) y la v27 (préstamo rotatorio de un ejemplar del club), la v33/v34 (ISBN obligatorio con dígito de control, reutilización de la obra por ISBN y taxonomía temática: cada género propone sus etiquetas, ninguna queda huérfana y las retiradas no pueden volver) las del contraste del título y la autoría con los datos del ISBN (acentos, subtítulos, «Eco, Umberto» y la diferencia entre «no coincide» y «no hay datos») las pruebas del **envoltorio de rutas** (sesión, cuerpo validado, cuota con `Retry-After`, origen, id de petición y errores en JSON), las de los **caminos de error de la capa HTTP** (`readJson` 415/413/400, `handleApiError` 422/429/500, errores de control de Next y la descarga de portadas: proveedor caído, 1×1 del proveedor, tamaño y poda de la caché), las de **deriva del esquema** (tablas, columnas e índices fijados, y volver a migrar no cambia nada ni pierde filas) y un test de contratos que verifica que **toda** mutación de la API pasa por `guard()` o justifica su excepción.

CI (`.github/workflows/ci.yml`) ejecuta `lint`, `test`, `build`, `npm audit --omit=dev` y **Playwright** (`npm run test:e2e`). Además, `npm run test:coverage` aplica **umbrales mínimos** (92 % de líneas, 80 % de ramas, 88 % de funciones) para que una funcionalidad nueva no entre sin pruebas que la cubran. En local: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` y, con el servidor arrancado, `npm run smoke` (rutas, cabeceras y rechazos esperados contra `http://localhost:3000`). Las E2E arrancan su propio servidor en `localhost:3100` (requiere `npx playwright install chromium` una vez). El acceso vive en `e2e/helpers.ts` y reintenta la pulsación de «Entrar» hasta que la ventana aparece (en `next dev` el primer clic podía llegar antes de la hidratación) y `e2e/global-setup.ts` vacía la tabla de cuotas antes de cada pasada, porque el límite de acceso (20 por cuenta cada 15 min) hacía fallar la segunda ejecución seguida con un 429 ajeno a lo que se estaba probando.

## Operación

- **Copia de seguridad**: `npm run db:backup` (usa la API `.backup()` de SQLite, ejecuta `integrity_check`, rota las N copias de `WANDERBIBLIOTHEK_BACKUP_KEEP`, cifra con AES-256-GCM si existe `WANDERBIBLIOTHEK_BACKUP_KEY` y lanza `WANDERBIBLIOTHEK_BACKUP_HOOK`; `npm run db:decrypt -- copia.db.enc salida.db` restaura; nunca copies el fichero en caliente con WAL activo).
- **Verificar un correo a mano**: `npm run user:verify -- correo@ejemplo.com` (con `--unverify` para lo contrario). Es la salida de emergencia cuando el proveedor de correo falla y alguien no puede publicar.
- **Cron**: `curl -X POST -H "Authorization: Bearer $MAINTENANCE_TOKEN" https://tu-dominio/api/cron/maintenance` desde un `systemd timer` o el cron del sistema, una vez al día.
- **Mantenimiento** (cron horario o diario): `curl -X POST -H "Authorization: Bearer $MAINTENANCE_TOKEN" https://tu-dominio/api/cron/maintenance`. Caduca solicitudes de más de 14 días, borra sesiones expiradas, purga avisos leídos de más de 90 días, actividad de más de 180, los contadores de cuotas, deja a `NULL` el `book_id` de los avisos cuyo libro ya no existe (para no servir enlaces roscos) y envía el recordatorio de los encuentros de club que ocurren en las próximas 24 horas (una vez por reunión).
- **Reloj**: el render no lee `Date.now()` ni `new Date()` (Next lo trata como valor inestable al prerenderizar); las marcas de tiempo de avisos, mantenimiento y limitadores las pone **SQLite** (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`). Si añades una consulta nueva con fecha, sigue esa pauta.
- **Caducidad en desarrollo**: `after(expireStaleRequestsThrottled)` se registra solo con `NODE_ENV=production`, porque Next 16 emite un diagnóstico de reloj en `next dev` aunque el callback no lea la hora. En desarrollo se usa `POST /api/cron/maintenance` o las pruebas.
- **Id de petición y latencia**: cada respuesta de la API lleva `x-request-id` (se respeta el que mande el proxy de delante) y `x-response-time`; cada petición deja una línea `[req] {"id":…,"method":…,"path":…,"status":…,"ms":…}` en el registro, marcada con `"slow":true` a partir de 500 ms. El `reference` que devuelve un 500 son los 8 primeros caracteres de ese id, así que un `grep` encuentra la traza exacta: `journalctl -u wanderbibliothek | grep 8f14e45f`. Para el p95 por ruta: `journalctl -u wanderbibliothek -o cat | grep '^\[req\] ' | sed 's/^\[req\] //' | jq -s 'group_by(.path) | map({path: .[0].path, n: length, p95: (map(.ms) | sort | .[length * 0.95 | floor])})'`.
- **Techo de SQLite**: medido, no supuesto, con `npm run bench:sqlite` (base temporal, misma configuración). En este equipo: **~99 000 escrituras/s** sueltas (una transacción por escritura; WAL con `synchronous=NORMAL` no hace `fsync` en cada confirmación), **~250 000/s** en lote, **~350 000 lecturas/s** por clave primaria y **~2 000/s** en una consulta con filtro y orden sobre 5 000 filas sin índice. Con 4 lectores y un escritor a la vez: **~63 000 escrituras/s y ~1 500 lecturas/s**. Consecuencias prácticas: el límite no es el número de visitas sino **la duración de cada transacción** (el proceso es de un solo hilo, así que una transacción larga frena a todo el servidor: mantenerlas en milisegundos) y el número de instancias es **una** (un escritor; el bus de avisos vive en memoria). Cuando el catálogo pase de decenas de miles de ejemplares, la consulta sin índice es lo primero que se nota: los índices de `INDEXES` en `db/schema.ts` están para eso.
- **Proxy inverso**: define `TRUST_PROXY=1` para que las cuotas se apliquen por IP real y para que la guardia de origen acepte `X-Forwarded-Host` (necesario si nginx o el balanceador reescriben `Host`).
- **URL pública**: `NEXT_PUBLIC_SITE_URL` es obligatoria en producción; sin ella el sitemap y los canonical apuntan a `localhost` y la app avisa por consola.
- **Esqueletos**: catorce rutas tienen `loading.tsx`. Las de datos (catálogo, estantería, intercambios, comunidad, lectores, clubes, listas y moderación, más las fichas y la cuenta) usan `AppSkeleton`, que pinta barra lateral y panel con su forma definitiva mientras llega el contenido; antes solo cuatro rutas daban señal al navegar. Las páginas legales y los flujos con enlace propio (`/verificar`, `/restablecer`) no lo necesitan: no consultan la base.
- **Caché**: `stats` y la actividad pública se sirven con `use cache` (`cacheLife("minutes")`, etiqueta `public-data`), así que la portada no recalcula esos agregados en cada visita.

## Despliegue

La guía completa (usuario de sistema, systemd, nginx, TLS, timers de cron y copia, actualización y restauración) está en [`deploy/README.md`](deploy/README.md). Resumen:

- **Servicio**: `deploy/wanderbibliothek.service` + `deploy/nginx.conf` + `deploy/env.example`. La app escucha en `127.0.0.1:3000` y nginx pone el TLS; `/api/requests/` va sin buffering (SSE).
- **Tareas**: `deploy/wanderbibliothek-maintenance.timer` (cada 15 min) y `deploy/wanderbibliothek-backup.timer` (diario).
- **Rotación de la clave de cifrado.** Los secretos se guardan como
  `enc:v2:<keyId>:<flags>:<iv>.<tag>.<datos>`: el id de la clave viaja dentro del
  propio valor y el `AAD` ata cada criptograma a su fila y su columna (`totp:<usuario>`,
  `ship:<solicitud>:<campo>`), de modo que mover un valor a otra fila no se puede
  descifrar. Para cambiar de clave sin perder nada:
  ```bash
  # 1. La clave nueva entra como activa y la vieja queda para leer
  APP_ENCRYPTION_KEY=<nueva> APP_ENCRYPTION_OLD_KEYS=<vieja> npm run rotate:secrets -- --dry-run
  # 2. Cuando el informe cuadre, sin --dry-run
  APP_ENCRYPTION_KEY=<nueva> APP_ENCRYPTION_OLD_KEYS=<vieja> npm run rotate:secrets
  # 3. Retira APP_ENCRYPTION_OLD_KEYS
  ```
  `npm run rotate:secrets` vuelve a cifrar los secretos TOTP y los datos de envío
  con la clave activa, comprueba que lo escrito se lee y es idempotente. Los valores
  antiguos `enc:v1:` (sin id ni contexto) se siguen leyendo, también con una clave
  anterior en `APP_ENCRYPTION_OLD_KEYS`. Sin `APP_ENCRYPTION_KEY` **no se guarda nada
  en claro**: el alta de un secreto falla con un error de configuración (solo en
  desarrollo se puede pedir texto plano con `WANDERBIBLIOTHEK_ALLOW_PLAINTEXT=1`).

- **Comprobación de entorno al arrancar** (`src/instrumentation.ts` + `src/lib/env-check.ts`): en producción el proceso revisa la configuración y deja en el log `[env] ERROR …` / `[env] AVISO …`. Si falta algo grave —`NEXT_PUBLIC_SITE_URL` en https, `MAIL_WEBHOOK_URL` o `APP_ENCRYPTION_KEY`— el proceso arranca pero responde **500** a todo, con el motivo en el log, en lugar de parecer que funciona y rechazar a la gente. `WANDERBIBLIOTHEK_SKIP_ENV_CHECK=1` lo salta a propósito.
- **Una sola instancia**: SQLite (un escritor) y el bus de avisos en memoria no admiten réplicas; escalar exige PostgreSQL y Redis/pubsub.
- **Dos rutas**: host con systemd (`deploy/wanderbibliothek.service`) o contenedor (`Dockerfile` + `docker-compose.yml`, multi-etapa con solo dependencias de producción). El build de la imagen se valida en CI.
- **`tsx` es dependencia de producción** (no de desarrollo): lo usan `admin:create`, `db:backup`, `user:verify` y `smoke`, también dentro de la imagen con `npm ci --omit=dev`.

## Sistema visual

- **Un solo shell** (`SiteShell`): todas las páginas internas comparten barra lateral (`SiteRail`), topbar con breadcrumb, contenido de 1120 px y pie. Ya no hay páginas con una maqueta distinta: Clubes, Lectores, Listas, Obra, Ficha, Perfil y Moderación conservan la navegación y el marco. La portada es la excepción: su catálogo ocupa todo el ancho libre a la derecha de la barra lateral (4 columnas desde 1400 px y 5 desde 1800 px) y el hero pasa a dos columnas desde 1400 px.
- **Cabecera de página** (`PageHeader`): `h1` serif de 28–34 px, descripción y acciones, sin overlines decorativos. Las páginas que ya tienen su propio hero (obra, ficha) usan solo el breadcrumb para no duplicar titulares.
- **Escala tipográfica**: serif únicamente para titulares; cuerpo 14 px; secundario 12–13 px. Los `h1` de sección tienen regla propia (`clamp(28px, 3vw, 32px)`), así que no vuelven a caer al tamaño del texto base.
- **Un solo color de origen**: fuera de `tokens.css` no queda ningún literal de color (solo los `#000` de las máscaras, que son alfa y no color). Los chips de estado (pendiente/aceptado/cerrado/caducado), el tono de «tu avatar», el texto sobre relleno y el borde fuerte son tokens con variante oscura; contraste medido 5,0–8,5:1 en las dieciséis combinaciones.
- **Estados vacíos**: una sola pieza (`EmptyState` / `EmptyNote` en `components/empty-state.tsx`) para catálogo, intercambios, moderación, listas y clubes; ocupa la fila entera de la rejilla cuando cae dentro del catálogo.
- **Tokens**: radios 12/8/6 px, escala de espacio 4–48 px (`--space-*`) y controles a 40 px (44 en móvil). **Cuatro breakpoints**: 480 px (móvil), 768 px (móvil ancho), 1120 px (tablet y escritorio pequeño) y 1400/1800 (retícula ancha de la portada); antes había doce valores distintos. **Ningún texto se subraya**: al pasar el ratón los enlaces cambian de color y de peso. Una sola sombra, reservada a overlays. El **borde de los controles** es su propio token (`--control-border`, 3,7:1 sobre papel y 3,5:1 sobre tarjeta) porque WCAG 1.4.11 pide 3:1 para identificar un campo; `--line` (1,2:1) queda para separadores. La letra sale de seis pasos (`--text-xs` 12 px … `--text-lg` 20 px): por debajo de 12 px solo quedan las iniciales de avatar. Los **tonos de portada y avatar** son parejas fondo/tinta (`--tone-*-bg` / `--tone-*-ink`) con variante oscura para los seis, así que ninguna portada de reserva brilla en modo oscuro.

**De dónde salen las portadas**: el servidor las busca en varios servicios y cachea el resultado en disco
(`.data/covers`), así que el navegador nunca habla con terceros. En paralelo y **gana la primera que llegue**:
Open Library por ISBN (con el ISBN-13 equivalente si la edición está en 10), Google Books por ISBN
(`GOOGLE_BOOKS_API_KEY` opcional, porque la cuota anónima se agota) y, si ninguna tiene la edición, Open
Library **por obra**: se prueba el título entero, sin el número de volumen («… I») y sin la coletilla del
subtítulo, y solo se acepta un resultado si el título se parece (o, como último recurso, si firma la misma
persona entre los dos primeros resultados). Sin esa comprobación, una búsqueda por título devolvía la
portada de cualquier libro. El servidor recuerda durante 24 h que un ISBN no tiene portada con una marca
versionada (`<isbn>.v2.miss`): al añadir un proveedor se sube el número y se reintenta todo.

**Subir la portada**: muchísimas ediciones —sobre todo alemanas— no están en ningún servicio. Quien
publica el ejemplar puede subir una foto desde la ficha del libro: `PUT /api/cover/book/<id>` recibe la
imagen en crudo (JPEG, PNG, WebP o GIF, ≤ 4 MB), el tipo se comprueba **por los primeros bytes** —no por
lo que declare el cliente— y solo puede hacerlo quien tiene un ejemplar de esa obra (o la administración).
La imagen se guarda como `upload-<bookId>.img` junto a la caché, **no la borra la limpieza automática** y
`books.cover_url` pasa a `/api/cover/book/<id>`, así que todas las copias de la obra enseñan la misma.
Quitarla devuelve la búsqueda por ISBN. Un cuerpo binario no se puede enviar desde un formulario de otro
origen, y además el guardia de origen y la cuota cierran el paso.

**Portadas sin imagen**: en vez de un hueco con iniciales se compone una **portadilla escrita a mano**: el título **completo** (sin recortar, en tres escalones de tamaño según lo largo que sea) y la firma de la autoría, separados por un filete, con la caligrafía **Tangerine** —pluma inglesa del XVII, Toshi Omagari, SIL OFL 1.1, 13 KB por peso recortados a los caracteres de un título—. Tangerine tiene la caja de minúsculas muy pequeña (0,26 em frente a 0,46 de una serif corriente), así que se compone a un cuerpo bastante mayor del habitual; los tamaños están en `cards.css`. Se usan dos pesos —700 para el título, 400 para la firma— y solo se descargan cuando hace falta (`font-display: swap`, `fonts.css`). La portadilla hace de hueco mientras llega la imagen real: en cuanto carga se retira, porque hay portadas con fondo transparente.
- **Cifras de la portada** (`hero-stats`): fila de **cuatro columnas iguales** al pie de la tarjeta del
  hero, separadas por una regla fina, con la cifra en serif (26–34 px según el ancho) y el rótulo a 12 px
  **centrados** en su columna. Sin iconos, sin fondo propio y sin aire de más: entre el botón del hero y la
  raya hay 14 px. Antes eran cuatro columnas con el texto pegado a la izquierda —cada una dejaba media
  columna vacía detrás y la banda parecía una tabla descolocada—; una versión intermedia con iconos en
  cuadros y fondo tintado se descartó por recargada. Los rótulos van en **singular o plural** según la cifra
  («1 club de lectura» frente a «6 lectores registrados»), también en alemán. En móvil pasan a 2×2 con una
  sola regla entre columnas.
- **Color contenido**: papel cálido y tinta, verde como único acento y coral solo para marca y acciones destructivas. Avatares y portadas sin imagen usan dos tonos (`sage`/`ochre`), con variante oscura.
- **Portada editorial**: el hero es una superficie plana con titular, un CTA y una **banda de cuatro cifras** al pie; sin cristal y sin botón melocotón. Lleva una **fotografía real** de estanterías (`public/hero/estanteria.webp`, 117 KB; Suzzallo Allen Library, CC BY 4.0, crédito en [`NOTICE`](NOTICE)) servida por la propia aplicación, como **capas de fondo del propio elemento** (no en un pseudo-elemento: así se recorta con el radio del borde y el contorno queda limpio), con un velo que sale del color de la tarjeta: bajo el titular el fondo es superficie plana (contraste medido 14,8:1 en el título y 6,1:1 en el párrafo) y la imagen aparece hacia la derecha. El contorno de esa tarjeta usa `--hero-border` (más marcado que `--line`, porque comparte plano con la foto). En oscuro la foto se atenúa con el mismo velo, y en móvil queda como textura en la franja superior. Debajo se muestra **una única fila de libros** (1 en móvil estrecho, 2 hasta 999 px, 3 hasta 1399, 4 hasta 1799 y 5 en pantallas mayores), sin filtros ni paginación.
- **Aplicación instalable**: `src/app/manifest.ts` publica nombre, colores, `start_url` y los iconos de `public/icons/` (192, 512 y variante *maskable*); `public/sw.js` es un service worker mínimo sin caché para no servir libros obsoletos y solo se registra en producción. El escaneo de ISBN usa la cámara cuando el navegador soporta `BarcodeDetector`; si no, el campo sigue siendo manual.
- **Descubrir el catálogo completo**: el botón del hero, el CTA bajo la fila y la entrada «Descubrir» del menú abren `/descubrir`, la sección con todas las filas, búsqueda, categorías, orden y paginación. La portada (`/`) y el catálogo (`/descubrir`) son vistas distintas de la misma app.
- **Catálogo**: las cinco categorías amplias comparten una fila de pestañas con subrayado (scroll horizontal en móvil); debajo, una barra única con búsqueda, contador (`aria-live`), orden y chips de filtros activos. Mientras se resuelve un filtro, la rejilla muestra tarjetas esqueleto y conserva la altura para evitar saltos.
- **Tarjetas**: portada de 210 px, categoría truncada en una línea, título serif a dos líneas y CTA de texto al pie; en móvil la portada baja a 165–200 px y el botón conserva 44 px de alto.
- **Navegación**: la barra lateral agrupa Descubrir, Estantería e Intercambios, con Comunidad como acceso único; Clubes, Lectores y Listas viven dentro de sus pestañas. La ciudad y los avisos de novedades se gestionan desde el menú de cuenta, que reúne perfil, **Cuenta** (`/cuenta`), avisos, moderación (solo admin) y cierre de sesión tanto en la app como en las páginas internas. La barra inferior móvil apunta al catálogo completo (`/descubrir`) y el botón central abre la oferta (`?offer=1`). **Quien administra ve la entrada «Moderación» en las dos barras laterales** —la del catálogo (`AppSidebar`) y la de las páginas internas (`SiteRail`)—: antes solo aparecía al abrir una ficha o la cuenta, porque esas vistas usan otro armazón.
- **Comunidad**: una sola fila de pestañas, filtro de ámbito (todo el país/ciudad), búsqueda contextual para clubes, lectores y listas, y “Crear club” dentro de su propia pestaña. Se eliminaron los enlaces duplicados de Clubes/Lectores/Listas de la cabecera y de la columna lateral.
- **Móvil**: hero compacto (cifras en tres columnas, texto recortado a tres líneas, sin estantería), primera tarjeta al borde del primer viewport y barra de filtros en dos filas (búsqueda a lo ancho, contador + orden debajo). Los filtros secundarios (distancia e idioma) se piden con el botón **Filtros** —lleva el número de filtros activos— y arrancan plegados: con ellos abiertos la primera tarjeta empezaba a ~590 px; plegados, a ~390.
- **Modo oscuro**: el hero y los tonos pastel usan tokens, no colores fijos. El conmutador de tema vive en el topbar, junto al idioma, y ya no flota sobre el contenido.

## Experiencia de uso aplicada
- **Vista previa sin sesión**: las tarjetas abren un resumen (portada, estado, ciudad, etiquetas) en lugar de un muro de login; “Entrar para pedirlo” conserva el libro de destino (`?next=`) y vuelve a él tras entrar.
- **Ciudad**: campo con búsqueda (`CityField`, `datalist` sobre las 123 ciudades de Alemania) en registro, oferta, club, edición y perfil; sin valores por defecto arbitrarios. Se cambia desde el menú de cuenta → ajustes; ya no se duplica como botón en la barra lateral.
- **Cerca de ti**: el catálogo muestra chips de distancia (toda Alemania, 10, 25, 50 y 100 km) que filtran por la ciudad del perfil, no solo ordenan. La ficha de la obra incluye **«Avísame de nuevos ejemplares»** y el número de personas de la ciudad que buscan el título; al publicar, si hay demanda local, el aviso de éxito lo dice.
- **Clubes con ejemplares**: la ficha del club muestra las copias disponibles de la lectura en curso en su ciudad, con enlace directo a cada ejemplar.
- **Idioma y lectura**: el formulario de publicación guarda el idioma del libro y el catálogo permite filtrar por él; en la ficha de la obra se puede marcar «Leyendo» o «Leído» y ver cuántas personas lo están leyendo o ya lo han leído.
- **Entrega verificada**: al aceptar un intercambio se genera un código de 6 cifras que solo ve quien entrega; la otra persona lo introduce (o escanea su QR) para confirmar la recepción. Sin código no se puede cerrar por la parte que recibe.
- **Foro del club**: solo lo leen los miembros; se borra lo propio, lo del club (quien lo creó) y lo que retire la moderación. Los mensajes se pueden denunciar y el panel puede ocultarlos y restablecerlos.
- **Votación**: una sola abierta por club, la abre quien lo creó y vota cada miembro; al cerrarla se puede fijar como lectura la opción más votada.
- **Publicar un libro**: el ISBN se puede teclear o **escanear con la cámara** (EAN-13/EAN-8/UPC-A mediante `BarcodeDetector`); si el navegador no lo soporta o se deniega el permiso, se explica y el campo manual sigue funcionando. La portada se completa después con Open Library.
- **Entrada y retorno**: los accesos a login desde una ficha o sus comentarios conservan `next` y vuelven al punto de origen. Si un invitado pulsa el corazón, tras entrar se guarda automáticamente el libro que quería guardar.
- **Solicitud sin texto**: se elimina el mensaje inicial que el servidor descartaba; la coordinación ocurre en la conversación cifrada tras aceptar.
- **Intercambio**: stepper Solicitado → Aceptado → Entrega → Valoración, confirmación antes de aceptar/rechazar/cancelar, elección entre **Packstation** y **dirección propia** para el envío y ayuda desplegable sobre el cifrado. La lista de intercambios muestra el **siguiente paso** de cada operación, el modo de entrega y la última actividad; desde el detalle se puede abrir una **incidencia** que revisa la moderación.
- **Perfil y confianza**: además de publicaciones, intercambios completados, comentarios, seguidores y valoración media, el perfil muestra la **antigüedad de la cuenta**.
- **Verificación**: aviso proactivo con reenvío cuando falta confirmar el correo (publicar, comentar y pedir lo exigen en producción). La guía de tres pasos que se pintaba sobre el catálogo **se retiró**: ocupaba el sitio del contenido y repetía lo que ya dicen el botón de ofrecer y el menú.
- **Accesibilidad**: contador de resultados con `aria-live`, `alt` de portada traducido, topbar sin desbordamiento a 320 px, candados con etiqueta y foco/foco atrapado ya existentes.
- **Moderación**: confirmación y “Deshacer” para retirar ejemplares, ocultar comentarios/clubes y suspender cuentas. Las **incidencias de intercambio** llegan al mismo panel con el título, el estado y la descripción del problema. El panel muestra además el embudo de producto: libros disponibles, solicitudes y completados de los últimos 30 días, y completados por usuario activo.
- **2FA**: código QR generado en el servidor además de la clave manual (`qrcode`).

## Siguientes pasos

1. PostgreSQL cuando haya varios procesos o despliegue horizontal: los módulos de `src/lib/repo/` son la única capa acoplada a SQL (`repo.ts` solo reexporta); el bus SSE actual es de un solo proceso y necesitaría Redis/pubsub.
2. Fotos reales del ejemplar (requiere almacenamiento de objetos y moderación de imágenes).
3. Geolocalización aproximada por ciudad (nunca direcciones exactas).
4. Clubs grandes con varios organizadores y reparto por capítulos (hoy el tope de 200 y una sola persona al frente resuelven el caso real).
5. Passkeys y códigos de recuperación de la 2FA (el historial de claves públicas ya existe desde la v28), además de varias claves activas por cuenta.
6. Paginación del listado de intercambios (hoy devuelve los últimos 500) y copia de seguridad automática antes de migrar.
7. Observabilidad real (OpenTelemetry, informes CSP) y copia de la clave de mensajería entre dispositivos.

## Seguridad

Para reportar una vulnerabilidad usa la pestaña **Security → Report a
vulnerability** del repositorio (aviso privado de GitHub; no abras un issue
público). Alcance, plazos de respuesta y buenas prácticas de autohospedaje:
[`SECURITY.md`](SECURITY.md).

El proyecto pasa **`npm audit` y `npm audit --omit=dev` sin avisos**. Hasta
noviembre de 2026 el audit completo mostraba 8 avisos moderados de `minimatch`
(«globparts amplification») que solo afectaban a la cadena de ESLint —nunca a
producción—; se cierran con un `overrides` acotado en `package.json` que sube
solo ese `minimatch` (el de `@typescript-eslint/typescript-estree`) a la versión
corregida, sin tocar el `minimatch` 3.x que usan los plugins de ESLint ni
aceptar el «arreglo» que proponía npm, que era un **downgrade** a
`eslint-config-next@15` (es decir, salir de Next 16). Revisado con `npm run lint`
sobre los 288 ficheros del proyecto y con una regla de `@typescript-eslint`
comprobando que sigue saltando.

## Contribuir

Entorno, comandos de calidad, convenciones de commits, obligación de traducir al
alemán y reglas de migración: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licencia y atribuciones

Código bajo licencia **MIT** — ver [`LICENSE`](LICENSE).

Los componentes y datos de terceros (fotografía de portada, tipografía de las
portadas) mantienen su propia licencia y están atribuidos en [`NOTICE`](NOTICE).
