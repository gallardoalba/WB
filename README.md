# Wanderbibliothek

Plataforma bilingüe (**castellano** por defecto y **alemán**) para **compartir e intercambiar libros físicos** entre lectores de toda Alemania, con capa social: fichas públicas, perfiles, actividad, avisos y conversación dentro de cada intercambio.

El idioma se elige con el selector del panel superior (banderas ES/DE). La preferencia se guarda en la cookie `wanderbibliothek-locale` y, si hay sesión, también en la cuenta (`users.locale`), así que se mantiene en cualquier dispositivo. Los textos que aún no tienen traducción caen al castellano, nunca a una clave técnica.

## Arrancar

Requiere Node.js 22 o superior.

```bash
npm install
npm run dev        # http://localhost:3000
```

La base SQLite se crea sola en `.data/book2peer.db` y se siembra con datos de demostración la primera vez.

```bash
npm run lint       # ESLint
npm test           # pruebas unitarias + integración del repositorio
npm run build      # build de producción
npm run db:reset   # borra la base local (se vuelve a sembrar al arrancar)
```

### Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `BOOK2PEER_DB` | `.data/book2peer.db` | Ruta del archivo SQLite (`:memory:` para pruebas) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Base para `sitemap.xml` y `robots.txt` |
| `TRUST_PROXY` | sin definir | `1` solo si hay un proxy propio delante: autoriza leer `X-Forwarded-For`/`X-Forwarded-Host` y activa las cuotas por IP. Sin él se aplican solo las cuotas globales y por cuenta (más altas), para que todas las personas no compartan un mismo cubo |
| `MAINTENANCE_TOKEN` | sin definir | Token del cron: `POST /api/cron/maintenance` con `Authorization: Bearer <token>`. Sin él el endpoint responde 404 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | sin definir | Crean el primer administrador si no existe ninguna cuenta admin (contraseña de 12+ caracteres) |
| `MAIL_WEBHOOK_URL` | sin definir | Endpoint que recibe `{to, subject, text}` para enviar los correos de verificación, recuperación y avisos. Los envíos pasan por `mail_outbox` con reintentos. Admite `MAIL_WEBHOOK_TOKEN` para autenticarse con `Bearer` |
| `APP_ENCRYPTION_KEY` | sin definir | 32 bytes en hex o base64 para cifrar secretos reversibles (TOTP). Obligatoria en producción |
| `BOOK2PEER_BACKUP_KEY` | sin definir | 32 bytes en hex o base64. Si está definida, `db:backup` guarda la copia cifrada con AES-256-GCM (`db:decrypt` para restaurarla) |
| `REQUIRE_EMAIL_VERIFICATION` | sin definir | `1` exige el correo confirmado para publicar, solicitar, comentar y escribir mensajes |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | sin definir | Activan Cloudflare Turnstile en el registro. Sin ellas se usa honeypot + tiempo mínimo |
| `ERROR_WEBHOOK_URL` / `ERROR_WEBHOOK_TOKEN` | sin definir | Reciben los errores 500 en JSON (Sentry, Logtail o webhook propio) |
| `BOOK2PEER_BACKUP_KEEP` | `14` | Copias de seguridad que se conservan al rotar |
| `BOOK2PEER_BACKUP_HOOK` | sin definir | Comando que recibe `BACKUP_FILE` para copia externa (rsync, rclone…) |
| `AUDIT_RETENTION_DAYS` | `0` | Días que se conserva `admin_audit` en el mantenimiento (0 = para siempre) |
| `SEED_DEMO` | `1` fuera de producción | Sembrar los datos de demostración. En producción nunca ocurre salvo que se ponga `1` a propósito |

La base se crea con permisos `0600` dentro de `.data` (`0700`). Usa `npm run db:backup` (API `.backup()` de SQLite) en vez de copiar el fichero en caliente.

### Usuarios de demostración

Solo existen en desarrollo (`NODE_ENV !== "production"`) o con `SEED_DEMO=1`. Contraseña común: `demo1234`

| Correo | Nombre | Ciudad | Rol |
| --- | --- | --- | --- |
| `ana@book2peer.test` | Ana Martínez | Stuttgart | lectora |
| `clara@book2peer.test` | Clara Montes | Stuttgart | lectora |
| `diego@book2peer.test` | Diego Ríos | Mannheim | lector |
| `lucia@book2peer.test` | Lucía Prieto | Karlsruhe | lectora |
| `marcos@book2peer.test` | Marcos Gil | Freiburg im Breisgau | lector |
| `admin@book2peer.test` | Equipo Wanderbibliothek | Stuttgart | **administración** (`/admin`) |

En un despliegue real: define `ADMIN_EMAIL`/`ADMIN_PASSWORD` o ejecuta
`npm run admin:create -- tu@correo 'contraseña-larga'`.

## Rutas

Sin sesión solo se puede ver la portada (`/`), el catálogo completo (`/?view=discover`) y los flujos de cuenta que necesitan enlace propio (`/restablecer`, `/verificar`). El resto de páginas redirigen al acceso (`/?auth=1&next=…`); el `sitemap.xml` anuncia únicamente la portada.

| Ruta | Contenido |
| --- | --- |
| `/` | Portada: hero, tres cifras y **una sola fila de libros**; es la vista pública por defecto. |
| `/?view=discover` | Catálogo completo con búsqueda, categorías, orden, filtros y paginación en la URL (`?q`, `?category`, `?sort`, `?tag`, `?page`). |
| `/?view=shelf`, `/?view=exchanges`, `/?view=community` | Secciones privadas de la app; sin sesión redirigen al acceso. |
| `/?offer=1` | Abre el formulario de publicación (si no hay sesión, primero el acceso). |
| `/?profile=1`, `/?notifications=1` | Abren el diálogo de cuenta o de avisos en la portada. |
| `/libro/[id]` | Ficha: estado, ISBN, notas del ejemplar, dueño, solicitud, guardar, denunciar, datos estructurados `Book`/`Offer` |
| `/u/[id]` | Perfil: biografía, métricas, valoración media, **reseñas**, estantería, bloquear/denunciar |
| `/lectores` | Directorio de lectores con búsqueda, ciudad y orden por cercanía o actividad |
| `/comunidad` | Redirige al hub de comunidad del catálogo (`/?view=community`) |
| `/listas` | Listas de lectura públicas de la comunidad |
| `/clubes` | Clubs de lectura por ciudad: crear, unirse, lectura en curso y día de encuentro |
| `/clubes/[clubId]` | Detalle del club: lectura, asistencia, miembros y ajustes para quien lo creó (editar, ceder, cerrar) |
| `/listas/[listId]` | Lista de lectura pública de un lector (curaduría compartible, editable por su dueño) |
| `/obra/[bookId]` | **Obra canónica**: conversación del título (comentarios, respuestas, spoilers, me gusta), ejemplares disponibles, recomendaciones por categoría y etiquetas, y datos estructurados `Book` |
| `/admin` | Solo administración: denuncias paginadas, incidencias de intercambio, cuentas suspendidas, comentarios ocultos, auditoría y métricas de producto |
| `/?auth=1` | Abre el diálogo de acceso |
| `/api/health` | Estado del servicio y de la base de datos |
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
| `/api/lists`, `/api/lists/[listId]/items` | `POST` de lista, alta y baja de obras en la lista |
| `/api/lists/[listId]` | `PATCH`: título y descripción · `DELETE`: borrar la lista |
| `/api/clubs`, `/api/clubs/[clubId]/membership` | `POST` de club y altas/bajas de miembros |
| `/api/clubs/[clubId]` | `PATCH`: nombre, encuentro y lectura · `DELETE`: cerrar el club |
| `/api/books/[bookId]/comments` | `GET` público del hilo (cursor `?before=<id>`) y `POST` para comentar o responder |
| `/api/books/[bookId]/want` | `GET` estado del aviso por obra · `POST` activa o desactiva «avísame si aparece en mi ciudad» |
| `/api/books/[bookId]/reading-state` | `GET` estado de lectura · `POST` «leyendo», «leído» o quitar la marca |
| `/api/clubs/[clubId]/loans` | `POST` presta un ejemplar a otro miembro · `PATCH` marca la devolución |
| `/api/requests/[requestId]/handover/verify` | `POST` confirma la recepción con el código de entrega de 6 cifras |
| `/api/comments/[commentId]` | `DELETE`: borra el propio comentario (con respuestas deja un hueco marcado) |
| `/api/comments/[commentId]/body` | `GET`: texto de un comentario con spoiler, que no viaja en el hilo hasta que se pide |
| `/api/comments/[commentId]/like` | `POST`: me gusta idempotente (no vale el propio) |
| `/api/admin/moderation` | Acciones directas: retirar/restablecer ejemplar, suspender/reactivar cuenta, ocultar/restablecer comentario o club |
| `/sitemap.xml`, `/robots.txt` | Indexación (el sitemap solo publica la portada) |

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
    comunidad/page.tsx        Redirige al hub de comunidad (`/?view=community`)
    lectores/page.tsx         Directorio de lectores con filtros
    clubes/ page.tsx y [clubId]/ Detalle de club con miembros y ajustes
    listas/[listId]/page.tsx  Lista de lectura pública
    admin/page.tsx            Panel de moderación y métricas de producto (solo rol admin)
    error.tsx / not-found.tsx / sitemap.ts / robots.ts
    api/                      auth, listings, requests, reports, blocks, notifications, account, admin, cron, health, books, comments, lists, clubs, users
    proxy.ts                  CSP con nonce y cabeceras de seguridad (convención `proxy`)
    styles/                   tokens · tipografía · estructura · portada · tarjetas · comunidad · diálogos · fichas · responsive · comentarios · grafo social · descubrimiento · clubs
  components/
    book2peer-app.tsx         Shell cliente con estado en la URL y pestañas de comunidad
    site-shell.tsx            Shell de páginas internas + PageHeader
    site-rail.tsx             Barra lateral de páginas internas
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
    club-loans.tsx            Préstamo rotatorio entre miembros del club
    isbn-scanner.tsx          Escaneo de ISBN con la cámara (`BarcodeDetector`) y alternativa manual
    pwa-register.tsx          Registro del service worker solo en producción
  lib/
    domain.ts                 Tipos y enums compartidos (etiquetas curadas incluidas)
    cities.ts                 Las 123 ciudades de Alemania y sus distancias
    db.ts                     Migraciones versionadas (v2–v25) + datos iniciales
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
    repo/clubloans.ts         Préstamo rotatorio de ejemplares dentro de un club
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
    observability.ts          Errores de servidor en consola y webhook opcional
    throttle.ts               Límites por cuota, IP de confianza y guardia de origen
    page-throttle.ts          Limitador de páginas públicas (no rompe la página, devuelve bool)
    api.ts / errors.ts        Respuestas JSON uniformes y `Retry-After`
    validation.ts             Esquemas Zod
    e2e.ts                    Cifrado de extremo a extremo (ECDH + HKDF + AES-GCM)
    post-offices.ts           Oficinas de Deutsche Post para el punto de entrega
tests/
  text, request-flow, repo, security, contracts y suites v4–v27 (24 ficheros)
e2e/
  app.spec.ts               Playwright: catálogo/búsqueda, tema, acceso, vista previa, guards y SEO
playwright.config.ts        Servidor propio en localhost:3100
```

### Datos

- `books` (edición, ISBN único) separado de `listings` (ejemplar concreto).
- Estados de ejemplar: `available`, `reserved`, `given`, `paused`, `removed`.
- Estados de solicitud: `pending`, `accepted`, `declined`, `cancelled`, `completed`, `expired`.
- **Migraciones versionadas** con `PRAGMA user_version` (actual: v25); las bases creadas con un esquema anterior se actualizan conservando los datos. La v12 permite una valoración por persona e intercambio (antes solo la primera parte podía valorar) y guarda el estado previo de un ejemplar retirado por moderación; la v13 añade el secreto TOTP y el último paso consumido para la verificación en dos pasos; la v14 añade el **punto de entrega** en una oficina de Deutsche Post (`requests.handover_office_id`) y el **sobre cifrado** de los mensajes (`messages.ciphertext`, `iv`, `encrypted`) junto con la clave pública de cada cuenta (`users.public_key`); la v15 añade `availability_alerts` para los avisos de novedad por ciudad; la v16 añade `users.public_key_id` (huella SHA-256 de la clave), `messages.key_id` y la bandeja `mail_outbox`; la v17 añade `users.email_notifications` para la preferencia de avisos por correo; la v18 añade `requests.owner_confirmed_at` y `requests.requester_confirmed_at` para el **cierre bilateral** del intercambio; la v19 añade a los clubs el **próximo encuentro** (`meets_at`), el estado de moderación, la política de entrada, el progreso de lectura, la asistencia (`club_attendance`), las solicitudes pendientes (`club_members.status`) y la tabla de métricas `product_events`; la v20 añade `users.locale` y sustituye las ciudades de Baden-Württemberg por las **123 ciudades de toda Alemania**, recalculando la matriz de distancias; la v21 reduce los géneros antiguos a las **cinco categorías principales** actuales; la v22 añade `book_wants` para los avisos por obra y ciudad; la v23 añade `books.language`, `reading_states` y `requests.handover_code`; la v24 completa el idioma de las ediciones de demostración; la v25 añade `club_loans` para la rotación de ejemplares dentro de un club.
- **Punto de entrega público**: `src/lib/post-offices.json` contiene 90 oficinas y sucursales asociadas reales de Deutsche Post en Baden-Württemberg (consulta Overpass de OpenStreetMap, `amenity=post_office`, noviembre de 2026; atribución ODbL). Al aceptar un intercambio se propone la oficina más cercana a quien entrega el libro y cualquiera de las dos partes puede cambiarla; el servidor solo acepta identificadores de esa lista, así que el campo no sirve para colar una dirección privada. **La cobertura de oficinas es todavía la de Baden-Württemberg**; fuera de esa zona la interfaz propone entrega en mano y el punto exacto se acuerda en la conversación. La plataforma sigue sin guardar direcciones de personas.
- Búsqueda con **FTS5** (`listings_fts`, contenido externo sobre `listings.search_key`): los disparadores la mantienen al día y admite prefijos y acentos.
- `request_reads` guarda hasta cuándo ha leído cada persona su conversación, para el contador de mensajes sin leer.
- **Capa social**: los comentarios cuelgan de la **obra** (`books`), no del ejemplar, así que la conversación de un título se comparte entre todas sus copias y sobrevive a que el libro cambie de manos. `book_comments` guarda `parent_id` (un solo nivel de respuestas), `spoiler` y `status` (`visible`/`hidden`/`deleted`); `book_comment_likes` la reacción. Los avisos de respuesta usan un tipo propio (`comment`) con `book_id`, y denunciar un comentario es un objetivo más de `reports` (`comment`). Las **incidencias de intercambio** se guardan como `reports` con `target_type = 'request'`; solo pueden abrirlas las dos partes y exigen una descripción para la moderación.
- **Grafo social**: `follows` (seguidor → seguido) alimenta el muro «Siguiendo» de la comunidad y los contadores del perfil. Los bloqueos cortan el seguimiento en ambos sentidos y las cuentas suspendidas no aparecen ni en el directorio ni en los muros.
- **Descubrimiento**: cada obra tiene una de las cinco **categorías principales** (`CATEGORIES`/`CATEGORY_DESCRIPTIONS` en `domain.ts`: Humanidades, Ciencias y técnica, Sociedad y política, Biografías y Ficción), con descripción visible al filtrar; `listing_tags` guarda hasta 3 **etiquetas curadas** (`TAGS` en `domain.ts`) por ejemplar, que se filtran con `?tag=`. El catálogo ordena por distancia y permite **limitar por radio** (`?radius=10|25|50|100`, 0 = toda Alemania) y **filtrar por idioma** (`?language=Español`). La ficha de la obra añade **recomendaciones locales** (misma categoría o etiquetas en común, sin llamadas externas), un aviso **«avísame de nuevos ejemplares»** por obra, un contador de demanda en la ciudad y los estados **«leyendo» / «leído»**. `reading_lists` + `reading_list_items` son listas de obra (públicas y editables solo por su dueño). `clubs` + `club_members` son clubs por ciudad con lectura en curso: **la conversación del club es el hilo de la obra**, no un chat paralelo; su ficha muestra los ejemplares disponibles en la ciudad y permite prestarlos entre miembros con fecha de devolución.
- **Recorrido**: las cifras del perfil (libros pasados/recibidos, kilómetros entre ciudades de los intercambios cerrados, ciudades, listas, clubs) y las **insignias** se derivan al vuelo con `getReaderJourney()`. No hay contadores guardados que se puedan desincronizar ni tablas nuevas que mantener.
- **Avisos de novedad por ciudad**: `availability_alerts` (persona + ciudad) hace que al publicar un ejemplar nuevo se cree un aviso interno para quien sigue esa ciudad, excluyendo a quien publica, a las cuentas suspendidas y a los bloqueos. Se activan o desactivan desde **Perfil → Editar perfil → Avisarme de nuevos libros** (`POST /api/alerts/availability`) y disparan un aviso interno (y un correo si la preferencia está activa).
- **Distancias reales**: `cities` guarda las coordenadas de 123 ciudades alemanas y `city_distances` la matriz de distancias (haversine precalculado). El catálogo ordena y muestra la distancia desde la ciudad de quien mira; sin ciudad conocida no se inventa ninguna cifra. Solo se guarda la ciudad, nunca la dirección ni el distrito.
- `account_tokens` guarda (hasheados) los tokens de verificación y recuperación, de un solo uso y con caducidad.
- Índices para sesiones, solicitudes, listados por dueño/estado, avisos y búsqueda.

### Invariantes garantizadas en servidor

Intercambios: el cierre es **bilateral**. Cada parte confirma la entrega por separado (`owner_confirmed_at` / `requester_confirmed_at`); la primera confirmación deja la solicitud en `accepted` y avisa a la otra, y solo cuando existen las dos pasa a `completed` y el ejemplar a `given`. Así una persona no puede cerrar el intercambio (ni habilitar reseñas) por las dos.

Cuentas y administración: las sesiones caducan de forma absoluta a los 30 días (la renovación deslizante no puede superarlos), el correo debe estar verificado para publicar y solicitar en producción, y **el panel de administración exige TOTP activo en producción**; sin él la cuenta administradora no puede moderar aunque tenga el rol. Los secretos TOTP se guardan cifrados con `APP_ENCRYPTION_KEY`.

Seguimiento: no se puede seguir a uno mismo, ni a una cuenta bloqueada o suspendida; los contadores excluyen cuentas inactivas. Listas y clubs: solo su dueño los edita, máximo 30 listas y 60 obras por lista, y quien creó un club no puede salir de él.

Clubs: máximo 10 por cuenta, 200 miembros por club y **nombre único dentro de su ciudad** (comparado sin mayúsculas ni espacios sobrantes, también al renombrar); así el directorio no se puede inundar de clubes duplicados. La entrada puede ser **abierta o con aprobación**: una solicitud pendiente no cuenta como miembro ni permite comentar como club hasta que quien lo creó la acepta. Solo el dueño puede retirar miembros, ceder el club a otro miembro o cerrarlo; el club también es un objetivo denunciable y la moderación puede ocultarlo y restablecerlo.

**Comunidad con pestañas en la URL**: el panel principal ofrece Conversaciones, Actividad, Clubes, Lectores y Listas, y el ámbito (región o ciudad) viaja en `?tab=` y `?scope=`. “Crear club” vive dentro de la pestaña Clubes y el botón de navegación sigue presente en el pie; la barra lateral ya no repite enlaces a Clubes, Lectores y Listas. Cada club puede fijar un **próximo encuentro con fecha** (además de la cadencia libre), confirmar asistencia, marcar el **progreso de lectura** y compartirse por enlace o invitar a alguien a quien sigues. El cron de mantenimiento envía un recordatorio interno el día antes del encuentro, una sola vez por reunión, y cualquier cambio de lectura, fecha o progreso avisa a los miembros.

Comentarios: solo sobre obras existentes, un único nivel de respuestas, `body` de 2 a 800 caracteres, autor activo, bloqueos cruzados filtrados **en SQL** (`NOT EXISTS` sobre `blocks`), comentarios de cuentas suspendidas fuera del hilo, ocultos visibles solo para su autor y moderación reversible (`hide_comment`/`restore_comment` con auditoría), *rate limit* de 60 comentarios/hora por cuenta. El **texto de un comentario con spoiler no viaja en el hilo**: se pide a `/api/comments/[id]/body` al revelarlo, así que no aparece en el código fuente de la página.

Privacidad: `GET /api/account/export` incluye comentarios, reacciones, seguidores/seguidos, listas, clubs y **mensajes enviados y recibidos** (los cifrados, como sobre `ciphertext` + `iv`); borrar la cuenta elimina ese contenido (los comentarios con respuestas quedan como hueco marcado para no romper los hilos) y corta `follows`, `blocks`, `club_members`, `reading_lists`, los clubs propios, avisos y tokens de cuenta. Los mensajes ya enviados se conservan para no romper las conversaciones de la otra parte; la política de privacidad debe reflejarlo.

### Mensajería de extremo a extremo

El servidor **no puede leer las conversaciones** nuevas: no guarda la clave privada ni el texto plano.

1. Al iniciar sesión, el navegador genera un par **ECDH P-256**. La clave privada se guarda como `CryptoKey` **no extraíble** en IndexedDB (`book2peer-e2e`); solo la mitad pública se envía a `PUT /api/account/keys` junto con su huella SHA-256 (`keyId`). El servidor valida que sea un punto real de P-256.
2. Para cada conversación se deriva una clave **AES-GCM-256** con ECDH + HKDF-SHA256, usando el identificador de la solicitud como `info` (dos hilos nunca comparten clave).
3. El mensaje se cifra en el cliente con **AAD** `requestId + remitente + keyId` y se envía como `{ ciphertext, iv, keyId }`; el servidor guarda el sobre y la huella. Un mensaje no se puede mover a otro hilo, remitente o clave.
4. La primera huella de la otra persona se recuerda (TOFU). Si cambia, la interfaz muestra la huella nueva y **bloquea el envío** hasta confirmarla; la cuenta recibe además un aviso interno de cambio de clave.
5. Si cualquiera de las dos cuentas tiene clave publicada, el servidor **rechaza el texto plano** (409): no se puede degradar el cifrado. Los mensajes anteriores a la v14 siguen visibles etiquetados como «sin cifrar (histórico)».
6. Los avisos de mensaje nuevo no incluyen el contenido y la moderación solo ve «mensaje cifrado»; denunciar un mensaje exige una descripción de quien denuncia.
7. La primera solicitud **ya no guarda un mensaje en claro**: se coordina todo en el hilo cifrado.

La conversación se actualiza **en vivo** con Server-Sent Events (`/api/requests/[id]/events`): el servidor solo compara la huella del último mensaje y avisa de que hay novedades; el contenido se vuelve a pedir y se descifra en el cliente. La señal llega por un bus interno en memoria (`src/lib/live.ts`) en cuanto se guarda un mensaje y, como red de seguridad, se revisa la huella cada pocos segundos; al consultar la base de datos (y no una memoria local) el canal sigue siendo correcto si el proceso se reinicia o si el mensaje llega por otra vía. Para varias instancias haría falta Redis/pubsub.

Limitaciones conocidas y deliberadas: la clave vive en el dispositivo, así que borrar los datos del navegador o cambiar de dispositivo impide descifrar el historial (nadie más puede hacerlo); si una persona pierde su clave, los mensajes nuevos dejan de ser legibles para ella y hay que volver a publicar una clave desde el dispositivo donde use la cuenta. No hay recuperación de clave por parte de la plataforma, ni la habrá: sería una puerta trasera.

El **mapa de Bücherschränke** sigue pendiente de una fuente de coordenadas verificada (OSM o acuerdos con bibliotecas/espacios públicos). No se muestran puntos inventados ni se consulta un servicio externo sin caché; por eso esta entrega prioriza préstamo, QR e idioma antes que el mapa.

- Un ejemplar solo se reserva si sigue `available` (`UPDATE ... WHERE status = 'available'` dentro de transacción).
- Al aceptar, las solicitudes rivales pasan a `expired`.
- Un índice único parcial impide dos solicitudes pendientes de la misma persona al mismo ejemplar.
- Solo el dueño acepta/rechaza; quien solicita puede cancelar; completar exige un intercambio aceptado.
- No se puede solicitar ni escribir a alguien con quien existe un bloqueo.
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

### Accesibilidad y diseño

- Contraste mínimo AA en textos, escala tipográfica desde 12 px y objetivos táctiles de 44 px en móvil.
- Diálogos con foco atrapado, cierre con `Escape` y restauración del foco.
- Enlace «Saltar al contenido», `aria-current` en navegación, filtros con `aria-pressed`, errores anunciados con `role="alert"`.
- El botón de avisos muestra un **contador numérico** (`9+` cuando hay más de nueve) y anuncia el total con `aria-label`; los no leídos se distinguen con color, borde y peso, no solo con el color. El menú de cuenta enlaza a la bandeja desde cualquier página y cada aviso enlaza a la obra o al perfil que lo provocó.
- **Modo oscuro** automático (`prefers-color-scheme`) y con conmutador manual (`data-theme` + `localStorage`), construido sobre una capa de tokens (`--paper`, `--surface`, `--line`, `--ink`…): no hay colores literales en los componentes, así que el tema claro y el oscuro comparten el mismo marcado.
- Las insignias del recorrido llevan rótulo y pista de texto (no solo icono y color) y las pestañas del perfil y de la comunidad se anuncian con `aria-current`.
- Layout verificado de 320 a 1920 px, con `prefers-reduced-motion`.

## Pruebas

`npm test` ejecuta **188 pruebas** unitarias/de integración en **31 ficheros** y `npm run test:e2e` añade **18 pruebas** de navegador con Playwright: catálogo y búsqueda, tema, acceso, vista previa con retorno a la ficha, guards de páginas internas y salud/SEO. Las suites cubren normalización de búsqueda e ISBN, reglas de transición, integración del repositorio sobre SQLite en memoria, seguridad (origen, `clientIp`, cuotas, host reenviado), v4 (FTS5, mensajes sin leer, moderación reversible, purgas), v5 (perfil editable, exportación completa, avisos individuales, paginación por cursor, denuncia de reseñas), v6 (distancias por ciudad, ejemplar pausado, suspensión coherente, tokens de cuenta), v7 (ciudades alemanas y validación de la lista cerrada), v8 (hilos de comentarios, paginación por cursor, me gusta, borrado con hueco, moderación reversible, bloqueos y avisos), v9 (seguir, muro «Siguiendo», directorio y muro del perfil), v10 (etiquetas curadas y filtro, listas de lectura y clubs por ciudad), v11 (recorrido del lector e insignias), v12 (bloqueos en listas y clubs, exportación y borrado de la capa social, seguidores/seguidos, spoilers fuera del HTML, edición de listas y clubs), v13 (límites de clubs y avisos con libro desaparecido) v14 (reseñas de ambas partes, spoilers fuera del muro, totales coherentes, bloqueos que cortan seguimientos, moderación reversible con estado previo, borrado completo de cuenta, nombres reservados, tope de cuerpo y tokens de un solo uso), v15 (TOTP contra el vector de la RFC 6238, migración v13, activación/verificación/desactivación y anti-replay), v16 (oficina más cercana en las ciudades de Baden-Württemberg y punto público genérico fuera de cobertura, punto de entrega al aceptar y al cambiarlo, mensajes cifrados sin texto plano, huellas de clave y AAD, TOTP cifrado, avisos sin contenido, rechazo de texto plano, moderación sin acceso al mensaje, avisos de novedad por ciudad, borrado completo de secretos y outbox de correo), el cierre bilateral de la v18 (primera confirmación deja `accepted`, la segunda completa) y la v19 (encuentros con fecha, aprobación de entrada, asistencia, progreso, cesión y retirada de miembros, invitaciones, listas públicas, cercanía y obras en común en el directorio, denuncia y moderación de clubs, recordatorios y métricas), la v20 (idioma por cuenta y ciudades de toda Alemania), la v21 (cinco categorías principales y migración de los géneros antiguos), la v22 (avisos guardados en el idioma de quien los recibe), la v23 (incidencias de intercambio y métricas de embudo), la v24 (recomendaciones por categoría y etiquetas, sin duplicados ni el libro actual) y la v25 (radio de distancia y avisos por obra), la v26 (idioma, estados de lectura y código de entrega) y la v27 (préstamo rotatorio de un ejemplar del club) más un test de contratos que verifica que **toda** mutación de la API pasa por `guard()` o justifica su excepción.

CI (`.github/workflows/ci.yml`) ejecuta `lint`, `test`, `build`, `npm audit --omit=dev` y **Playwright** (`npm run test:e2e`). En local: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` y, con el servidor arrancado, `npm run smoke` (rutas, cabeceras y rechazos esperados contra `http://localhost:3000`). Las E2E arrancan su propio servidor en `localhost:3100` (requiere `npx playwright install chromium` una vez).

## Operación

- **Copia de seguridad**: `npm run db:backup` (usa la API `.backup()` de SQLite, ejecuta `integrity_check`, rota las N copias de `BOOK2PEER_BACKUP_KEEP`, cifra con AES-256-GCM si existe `BOOK2PEER_BACKUP_KEY` y lanza `BOOK2PEER_BACKUP_HOOK`; `npm run db:decrypt -- copia.db.enc salida.db` restaura; nunca copies el fichero en caliente con WAL activo).
- **Verificar un correo a mano**: `npm run user:verify -- correo@ejemplo.com` (con `--unverify` para lo contrario). Es la salida de emergencia cuando el proveedor de correo falla y alguien no puede publicar.
- **Cron**: `curl -X POST -H "Authorization: Bearer $MAINTENANCE_TOKEN" https://tu-dominio/api/cron/maintenance` desde un `systemd timer` o el cron del sistema, una vez al día.
- **Mantenimiento** (cron horario o diario): `curl -X POST -H "Authorization: Bearer $MAINTENANCE_TOKEN" https://tu-dominio/api/cron/maintenance`. Caduca solicitudes de más de 14 días, borra sesiones expiradas, purga avisos leídos de más de 90 días, actividad de más de 180, los contadores de cuotas, deja a `NULL` el `book_id` de los avisos cuyo libro ya no existe (para no servir enlaces roscos) y envía el recordatorio de los encuentros de club que ocurren en las próximas 24 horas (una vez por reunión).
- **Reloj**: el render no lee `Date.now()` ni `new Date()` (Next lo trata como valor inestable al prerenderizar); las marcas de tiempo de avisos, mantenimiento y limitadores las pone **SQLite** (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`). Si añades una consulta nueva con fecha, sigue esa pauta.
- **Caducidad en desarrollo**: `after(expireStaleRequestsThrottled)` se registra solo con `NODE_ENV=production`, porque Next 16 emite un diagnóstico de reloj en `next dev` aunque el callback no lea la hora. En desarrollo se usa `POST /api/cron/maintenance` o las pruebas.
- **Proxy inverso**: define `TRUST_PROXY=1` para que las cuotas se apliquen por IP real y para que la guardia de origen acepte `X-Forwarded-Host` (necesario si nginx o el balanceador reescriben `Host`).
- **URL pública**: `NEXT_PUBLIC_SITE_URL` es obligatoria en producción; sin ella el sitemap y los canonical apuntan a `localhost` y la app avisa por consola.
- **Caché**: `stats` y la actividad pública se sirven con `use cache` (`cacheLife("minutes")`, etiqueta `public-data`), así que la portada no recalcula esos agregados en cada visita.

## Despliegue

La guía completa (usuario de sistema, systemd, nginx, TLS, timers de cron y copia, actualización y restauración) está en [`deploy/README.md`](deploy/README.md). Resumen:

- **Servicio**: `deploy/book2peer.service` + `deploy/nginx.conf` + `deploy/env.example`. La app escucha en `127.0.0.1:3000` y nginx pone el TLS; `/api/requests/` va sin buffering (SSE).
- **Tareas**: `deploy/book2peer-maintenance.timer` (cada 15 min) y `deploy/book2peer-backup.timer` (diario).
- **Comprobación de entorno al arrancar** (`src/instrumentation.ts` + `src/lib/env-check.ts`): en producción el proceso revisa la configuración y deja en el log `[env] ERROR …` / `[env] AVISO …`. Si falta algo grave —`NEXT_PUBLIC_SITE_URL` en https, `MAIL_WEBHOOK_URL` o `APP_ENCRYPTION_KEY`— el proceso arranca pero responde **500** a todo, con el motivo en el log, en lugar de parecer que funciona y rechazar a la gente. `BOOK2PEER_SKIP_ENV_CHECK=1` lo salta a propósito.
- **Una sola instancia**: SQLite (un escritor) y el bus de avisos en memoria no admiten réplicas; escalar exige PostgreSQL y Redis/pubsub.
- **`npm ci` incluye devDependencies** porque los scripts de operación (`admin:create`, `db:backup`, `user:verify`, `smoke`) corren con `tsx`.

## Sistema visual

- **Un solo shell** (`SiteShell`): todas las páginas internas comparten barra lateral (`SiteRail`), topbar con breadcrumb, contenido de 1120 px y pie. Ya no hay páginas con una maqueta distinta: Clubes, Lectores, Listas, Obra, Ficha, Perfil y Moderación conservan la navegación y el marco. La portada es la excepción: su catálogo ocupa todo el ancho libre a la derecha de la barra lateral (4 columnas desde 1400 px y 5 desde 1800 px) y el hero pasa a dos columnas desde 1400 px.
- **Cabecera de página** (`PageHeader`): `h1` serif de 28–34 px, descripción y acciones, sin overlines decorativos. Las páginas que ya tienen su propio hero (obra, ficha) usan solo el breadcrumb para no duplicar titulares.
- **Escala tipográfica**: serif únicamente para titulares; cuerpo 14 px; secundario 12–13 px. Los `h1` de sección tienen regla propia (`clamp(28px, 3vw, 32px)`), así que no vuelven a caer al tamaño del texto base.
- **Tokens**: radios 12/8/6 px, escala de espacio 4–48 px (`--space-*`) y controles a 40 px (44 en móvil). Una sola sombra, reservada a overlays.
- **Color contenido**: papel cálido y tinta, verde como único acento y coral solo para marca y acciones destructivas. Avatares y portadas sin imagen usan dos tonos (`sage`/`ochre`), con variante oscura.
- **Portada editorial**: el hero es una superficie plana con titular, un CTA y tres cifras en una banda a todo el ancho, separadas por reglas; sin foto, sin cristal y sin botón melocotón. Debajo se muestra **una única fila de libros** (1 en móvil estrecho, 2 hasta 999 px, 3 hasta 1399, 4 hasta 1799 y 5 en pantallas mayores), sin filtros ni paginación.
- **Aplicación instalable**: `src/app/manifest.ts` publica nombre, colores, `start_url` y los iconos de `public/icons/` (192, 512 y variante *maskable*); `public/sw.js` es un service worker mínimo sin caché para no servir libros obsoletos y solo se registra en producción. El escaneo de ISBN usa la cámara cuando el navegador soporta `BarcodeDetector`; si no, el campo sigue siendo manual.
- **Descubrir el catálogo completo**: el botón del hero, el CTA bajo la fila y la entrada «Descubrir» del menú abren `?view=discover`, la sección con todas las filas, búsqueda, categorías, orden y paginación. La portada (`/`) y el catálogo (`/?view=discover`) son vistas distintas de la misma app.
- **Catálogo**: las cinco categorías amplias comparten una fila de pestañas con subrayado (scroll horizontal en móvil); debajo, una barra única con búsqueda, contador (`aria-live`), orden y chips de filtros activos. Mientras se resuelve un filtro, la rejilla muestra tarjetas esqueleto y conserva la altura para evitar saltos.
- **Tarjetas**: portada de 210 px, categoría truncada en una línea, título serif a dos líneas y CTA de texto al pie; en móvil la portada baja a 165–200 px y el botón conserva 44 px de alto.
- **Navegación**: “Tu espacio” agrupa Descubrir, Estantería e Intercambios; Comunidad es un único acceso y Clubes/Listas/Lectores viven dentro de sus pestañas. La ciudad y los avisos de novedades ya no ocupan la barra lateral: se gestionan desde el menú de cuenta, que reúne perfil, ajustes/ciudad, avisos, moderación (solo admin) y cierre de sesión tanto en la app como en las páginas internas. La barra inferior móvil apunta siempre al catálogo completo (`?view=discover`) y el botón central abre la oferta (`?offer=1`).
- **Comunidad**: una sola fila de pestañas, filtro de ámbito (región/ciudad), búsqueda contextual para clubes, lectores y listas, y “Crear club” dentro de su propia pestaña. Se eliminaron los enlaces duplicados de Clubes/Lectores/Listas de la cabecera y de la columna lateral.
- **Móvil**: hero compacto (cifras en tres columnas, texto recortado a tres líneas), primera tarjeta al borde del primer viewport y barra de filtros en dos filas (búsqueda a lo ancho, contador + orden debajo).
- **Modo oscuro**: el hero y los tonos pastel usan tokens, no colores fijos. El conmutador de tema vive en el topbar, junto al idioma, y ya no flota sobre el contenido.

## Experiencia de uso aplicada
- **Vista previa sin sesión**: las tarjetas abren un resumen (portada, estado, ciudad, etiquetas) en lugar de un muro de login; “Entrar para pedirlo” conserva el libro de destino (`?next=`) y vuelve a él tras entrar.
- **Ciudad**: campo con búsqueda (`CityField`, `datalist` sobre las 123 ciudades) en registro, oferta, club, edición y perfil; sin valores por defecto arbitrarios. Se cambia desde el menú de cuenta → ajustes; ya no se duplica como botón en la barra lateral.
- **Cerca de ti**: el catálogo muestra chips de distancia (toda Alemania, 10, 25, 50 y 100 km) que filtran por la ciudad del perfil, no solo ordenan. La ficha de la obra incluye **«Avísame de nuevos ejemplares»** y el número de personas de la ciudad que buscan el título; al publicar, si hay demanda local, el aviso de éxito lo dice.
- **Clubes con ejemplares**: la ficha del club muestra las copias disponibles de la lectura en curso en su ciudad, con enlace directo a cada ejemplar.
- **Idioma y lectura**: el formulario de publicación guarda el idioma del libro y el catálogo permite filtrar por él; en la ficha de la obra se puede marcar «Leyendo» o «Leído» y ver cuántas personas lo están leyendo o ya lo han leído.
- **Entrega verificada**: al aceptar un intercambio se genera un código de 6 cifras que solo ve quien entrega; la otra persona lo introduce (o escanea su QR) para confirmar la recepción. Sin código no se puede cerrar por la parte que recibe.
- **Préstamo de club**: un miembro puede prestar su ejemplar a otro miembro con fecha de devolución; el ejemplar queda reservado y vuelve a estar disponible al marcarlo como devuelto.
- **Publicar un libro**: el ISBN se puede teclear o **escanear con la cámara** (EAN-13/EAN-8/UPC-A mediante `BarcodeDetector`); si el navegador no lo soporta o se deniega el permiso, se explica y el campo manual sigue funcionando. La portada se completa después con Open Library.
- **Entrada y retorno**: los accesos a login desde una ficha o sus comentarios conservan `next` y vuelven al punto de origen. Si un invitado pulsa el corazón, tras entrar se guarda automáticamente el libro que quería guardar.
- **Solicitud sin texto**: se elimina el mensaje inicial que el servidor descartaba; la coordinación ocurre en la conversación cifrada tras aceptar.
- **Intercambio**: stepper Solicitado → Aceptado → Entrega → Valoración, confirmación antes de aceptar/rechazar/cancelar, alternativa explícita cuando no hay oficina de Deutsche Post cerca y ayuda desplegable sobre el cifrado. La lista de intercambios muestra el **siguiente paso** de cada operación, el modo de entrega y la última actividad; desde el detalle se puede abrir una **incidencia** que revisa la moderación.
- **Perfil y confianza**: además de publicaciones, intercambios completados, comentarios, seguidores y valoración media, el perfil muestra la **antigüedad de la cuenta**.
- **Onboarding y verificación**: guía de tres pasos descartable por cuenta y aviso proactivo con reenvío cuando falta confirmar el correo (publicar, comentar y pedir lo exigen en producción).
- **Accesibilidad**: contador de resultados con `aria-live`, `alt` de portada traducido, topbar sin desbordamiento a 320 px, candados con etiqueta y foco/foco atrapado ya existentes.
- **Moderación**: confirmación y “Deshacer” para retirar ejemplares, ocultar comentarios/clubes y suspender cuentas. Las **incidencias de intercambio** llegan al mismo panel con el título, el estado y la descripción del problema. El panel muestra además el embudo de producto: libros disponibles, solicitudes y completados de los últimos 30 días, y completados por usuario activo.
- **2FA**: código QR generado en el servidor además de la clave manual (`qrcode`).

## Siguientes pasos

1. PostgreSQL cuando haya varios procesos o despliegue horizontal: los módulos de `src/lib/repo/` son la única capa acoplada a SQL (`repo.ts` solo reexporta); el bus SSE actual es de un solo proceso y necesitaría Redis/pubsub.
2. Fotos reales del ejemplar (requiere almacenamiento de objetos y moderación de imágenes).
3. Geolocalización aproximada por ciudad (nunca direcciones exactas).
4. Clubs grandes con varios organizadores y reparto por capítulos (hoy el tope de 200 y una sola persona al frente resuelven el caso real).
5. Historial de claves públicas y varias dispositivos, además de passkeys y códigos de recuperación de la 2FA.
6. Paginación del listado de intercambios (hoy devuelve los últimos 500) y copia de seguridad automática antes de migrar.
7. Observabilidad real (OpenTelemetry, informes CSP) y copia de la clave de mensajería entre dispositivos.
