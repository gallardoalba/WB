/**
 * Documentación técnica de la plataforma (`/documentacion`).
 *
 * El README del repositorio presenta el proyecto; los detalles de arquitectura,
 * rutas, datos, seguridad y operación viven aquí, dentro de la aplicación y en
 * sus dos lenguas.
 *
 * Igual que `legal.ts`, el texto se compone por idioma en lugar de pasar por el
 * diccionario: son párrafos largos y `i18n.ts` solo debe llevar textos de
 * interfaz. Los identificadores (rutas, ficheros, variables) son los mismos en
 * las tres versiones.
 */

import { REPOSITORY } from "./brand";
import type { Locale } from "./i18n";
import { EN } from "./technical-en";

export type DocBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  /** Lista con una etiqueta en negrita delante: no depende de Markdown. */
  | { kind: "terms"; items: { label: string; text: string }[] }
  | { kind: "code"; lines: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "links"; items: { label: string; href: string; note: string }[] };

export type DocSection = { id: string; heading: string; blocks: DocBlock[] };

export type TechnicalDocument = {
  title: string;
  updated: string;
  intro: string[];
  sections: DocSection[];
};

/** Fecha de la última revisión del texto. */
const UPDATED = "2026-11-06";

const ES: TechnicalDocument = {
  title: "Documentación técnica",
  updated: UPDATED,
  intro: [
    "Cómo está construida Wanderbibliothek: arquitectura, rutas, datos, seguridad y operación. Está pensada para quien va a leer el código, desplegarlo o auditar qué guarda.",
    "Todo lo que se describe aquí está en el repositorio. Si el código cambia, esta página cambia con él.",
  ],
  sections: [
    {
      id: "resumen",
      heading: "Resumen",
      blocks: [
        {
          kind: "p",
          text: "Monolito modular en Next.js 16 (App Router con Cache Components), TypeScript en modo estricto y SQLite con `better-sqlite3`. Un solo proceso: SQLite admite un escritor y el bus de avisos en vivo vive en memoria.",
        },
        {
          kind: "p",
          text: "No hay servicios externos obligatorios. Las portadas y las fichas bibliográficas las pide el servidor y se cachean en disco, así que el navegador nunca habla con terceros.",
        },
        {
          kind: "p",
          text: "El código está bajo licencia MIT. Esta página describe el código que ejecuta la instancia que la sirve.",
        },
      ],
    },
    {
      id: "arquitectura",
      heading: "Arquitectura",
      blocks: [
        {
          kind: "code",
          lines: [
            "src/",
            "  app/                 páginas y route handlers (App Router)",
            "    api/               72 handlers agrupados por dominio",
            "    styles/            tokens, tipografía, estructura, tarjetas, diálogos, fichas",
            "    proxy.ts           CSP con nonce y cabeceras de seguridad",
            "  components/          armazón de servidor e islas de cliente",
            "  lib/",
            "    db/                conexión, esquema base (v2), migraciones (v3–v45), seed",
            "    repo/              consultas SQL por dominio; `repo.ts` solo reexporta",
            "    validation.ts      esquemas Zod con mensajes traducidos",
            "    secret-box.ts      cifrado reversible con anillo de claves (TOTP)",
            "    e2e.ts             cifrado de extremo a extremo (ECDH + HKDF + AES-GCM)",
            "    route.ts           envoltorio de rutas: sesión, cuerpo, cuota, errores",
            "tests/                 663 pruebas unitarias y de integración (82 ficheros)",
            "e2e/                   pruebas de navegador con Playwright (6 ficheros)",
            "deploy/                systemd, nginx, plantilla de entorno y guía",
          ],
        },
        {
          kind: "p",
          text: "El armazón (`site-shell.tsx`, `site-rail.tsx`) es Server Component: la barra lateral, la cabecera, el pie y la navegación móvil llegan ya pintados y solo se hidratan las islas interactivas (`account-menu`, `theme-toggle`, `locale-switcher`, `verify-email-banner`).",
        },
        {
          kind: "p",
          text: "El diccionario alemán no viaja al navegador: `i18n.ts` solo se importa en el servidor y el layout entrega al proveedor de cliente los textos del idioma activo, no el diccionario entero. Además van indexados por un identificador de 32 bits (`messageId`) en vez de por el texto origen: la clave ocupa diez dígitos y el texto castellano no viaja, lo que deja el HTML en alemán en 182 KB en lugar de 236.",
        },
        {
          kind: "p",
          text: "`getDb()` intercepta `prepare` para reutilizar sentencias compiladas (caché FIFO de 400 por conexión). Los agregados públicos se sirven con `use cache` y la etiqueta `public-data`, que invalidan las rutas que mutan.",
        },
        {
          kind: "p",
          text: "El render no lee `Date.now()` ni `new Date()`: Next lo trata como valor inestable al prerenderizar. Las marcas de tiempo de avisos, mantenimiento y limitadores las pone SQLite con `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.",
        },
      ],
    },
    {
      id: "rutas",
      heading: "Rutas",
      blocks: [
        {
          kind: "p",
          text: "Las páginas internas exigen sesión; sin ella redirigen a `/?auth=1&next=…`. Son públicas la portada, las páginas legales, los flujos con enlace propio y esta documentación. `robots.txt` veta el catálogo y los perfiles para no publicar en buscadores el nombre y la ciudad de cada lector.",
        },
        {
          kind: "table",
          head: ["Ruta", "Contenido"],
          rows: [
            ["`/`", "Portada pública: hero, cuatro cifras y una fila de libros."],
            ["`/descubrir`", "Catálogo completo con búsqueda, categorías, orden y paginación en la URL. Se ve sin sesión; pedir un libro sí la exige."],
            ["`/werk/[id]`", "Ficha pública de la obra con JSON-LD `Book`/`Offer`: la URL que se indexa."],
            ["`/ofrecer`", "Publicar un ejemplar: el ISBN rellena la ficha bibliográfica."],
            ["`/buscar`", "Buscador global: obras, clubes, lectores y listas."],
            ["`/estanteria`, `/intercambios`", "Secciones privadas: ejemplares propios y solicitudes con su siguiente paso."],
            ["`/comunidad`", "Hub con pestañas (conversaciones, actividad, clubes, lectores, listas) y ámbito en `?scope=`."],
            ["`/lectores`", "Directorio con búsqueda, ciudad y orden por cercanía o actividad."],
            ["`/clubes`, `/clubes/[clubId]`", "Clubes por ciudad: solicitudes, lectura en curso, votación, asistencia y foro privado."],
            ["`/listas`, `/listas/[listId]`", "Listas de lectura: se leen sin sesión (la firma solo aparece si su autor la autoriza) y solo las edita su dueño."],
            ["`/libro/[id]`", "Ficha del ejemplar con metadatos y JSON-LD `Book`/`Offer`."],
            ["`/obra/[bookId]`", "Obra canónica: conversación del título, ejemplares y recomendaciones."],
            ["`/u/[id]`", "Perfil público: biografía, métricas, reseñas, estantería y seguimiento."],
            ["`/cuenta`", "Ajustes: perfil, avisos, contraseña, cifrado, segundo factor, exportación y borrado."],
            ["`/admin`", "Moderación de la comunidad; exige el segundo factor activo."],
            ["`/privacidad`, `/aviso-legal`", "Política de privacidad (art. 13 RGPD) y aviso legal (§ 5 DDG)."],
            ["`/verificar`, `/restablecer`", "Confirmación de correo y contraseña nueva desde el enlace."],
            ["`/documentacion`", "Esta página."],
            ["`/projekt`", "Qué es el proyecto, por qué existe, que no tiene ánimo de lucro y qué demuestra."],
            ["`/api/health`", "Estado del servicio y de la base de datos."],
            ["`/sitemap.xml`, `/robots.txt`", "Indexación: el sitemap publica la portada, las fichas de obra y las páginas informativas **en los tres idiomas** (con `xhtml:link`), y `/indexnow` avisa a Bing —y con él a DuckDuckGo y Ecosia— cuando se publica un libro."],
          ],
        },
        {
          kind: "p",
          text: "La API tiene 72 handlers en `src/app/api`. Casi todos se declaran con `route()` (`src/lib/route.ts`), que aplica en un solo sitio la sesión, el esquema Zod del cuerpo, la cuota con guardia de origen y `handleApiError()`; `tests/route.test.ts` comprueba sobre los ficheros que ninguna ruta se quede sin traducir errores a JSON.",
        },
        {
          kind: "list",
          items: [
            "`/api/auth/*`: registro, acceso, cierre, sesión, verificación y recuperación con tokens de un solo uso.",
            "`/api/listings`, `/api/listings/[id]`, `…/favorite`: publicar, editar, retirar y guardar ejemplares.",
            "`/api/requests`, `/api/requests/[id]` y sus derivados (`events` por SSE, `messages`, `read`, `review`): todo el ciclo del intercambio.",
            "`/api/books/*`: búsqueda de obras, comentarios, me gusta, avisos por obra y estados de lectura.",
            "`/api/clubs/*`: club, miembros, moderadores, invitaciones, asistencia, cesión, foro, votaciones y solicitudes de entrada.",
            "`/api/lists/*`, `/api/direct/*`, `/api/users/[userId]/follow`, `/api/blocks`: listas, mensajería directa cifrada, seguimiento y bloqueos.",
            "`/api/account/*`: perfil, idioma, contraseña, claves de cifrado, TOTP, exportación y borrado.",
            "`/api/admin/*`, `/api/reports`, `/api/comments/[id]`, `/api/notifications`: denuncias, moderación, comentarios y avisos.",
            "`/api/cover/*`, `/api/isbn/[isbn]`: portadas cacheadas y ficha bibliográfica (DNB y Open Library).",
            "`/api/cron/maintenance`: tareas programadas, con `MAINTENANCE_TOKEN`: reintenta los avisos de Mastodon, purga lo viejo y, con `MASTODON_LIKES=on`, da unos pocos «me gusta» espaciados a publicaciones sobre libros.",
          ],
        },
      ],
    },
    {
      id: "datos",
      heading: "Datos",
      blocks: [
        {
          kind: "list",
          items: [
            "`books` es la edición (ISBN único) y `listings` el ejemplar concreto; `books.work_key` agrupa las ediciones de una misma obra, así que comparten conversación y lista de copias.",
            "Estados de ejemplar: `available`, `reserved`, `given`, `paused`, `removed`.",
            "Estados de solicitud: `pending`, `accepted`, `declined`, `cancelled`, `completed`, `expired`.",
            "Búsqueda con FTS5 (`listings_fts`) mantenida por disparadores; `unaccent()` pliega las tildes para que «Lucía» se encuentre escribiendo «lucia».",
            "`cities` guarda las ciudades conocidas con sus coordenadas (la semilla alemana) y `city_distances` su matriz de distancias. La ciudad que escribe una persona se comprueba contra OpenStreetMap: `resolveCity()` pregunta a Nominatim, limitado a países europeos, y guarda el nombre con el que lo conoce el mapa. La distancia es un dato secundario: una ciudad fuera de la lista no muestra kilómetros.",
          ],
        },
        {
          kind: "p",
          text: "Las migraciones se versionan con `PRAGMA user_version` (actual: v45) y conservan los datos de una instalación anterior. La v40 da a cada dispositivo su propia ranura de clave (`web` y `android`) y guarda un sobre cifrado por cada clave del destinatario, así que el navegador y la app leen los mismos mensajes; la v38 vuelve a abrir el catálogo a todas las ciudades, añade `requests.ship_kind` y `ship_street`, cifra los datos de envío que la v37 guardó en claro y retira las oficinas de Deutsche Post; la v36 añadió la mensajería directa cifrada y la v37 el envío por correo. Las tres siguientes (v41–v43) crean la bandeja de salida social (`social_outbox`) y le añaden la imagen del anuncio y el tope diario por cuenta; la v44 cierra el círculo del intercambio: el ejemplar entregado queda `given` y quien lo recibe estrena su propia copia; la v45 estrena `social_likes`, la memoria de los «me gusta» del bot.",
        },
        {
          kind: "p",
          text: "Las columnas de la entrega y del envío (`handover_code`, `handover_method`, `ship_kind`, `ship_number`, `ship_station`, `ship_street`, `ship_postal_code`, `ship_city`) siguen en la base para no borrar lo que se guardó en su momento, pero ya no las escribe ni las lee nadie: la entrega se acuerda en la conversación del intercambio y cada parte confirma en la plataforma cuando tiene el libro, sin código y sin direcciones.",
        },
        {
          kind: "p",
          text: "Un intercambio no deja el libro huérfano: al cerrarse, el ejemplar entregado queda `given` (es el histórico) y quien lo recibe estrena **su propia copia**, con la misma edición y la misma condición, en su ciudad y en pausa (`listings.from_listing_id` y `from_request_id` guardan el rastro). Desde su estantería puede activarla y el libro vuelve a circular; si el ejemplar original lo había retirado la moderación, la copia nace igualmente y nada vuelve al catálogo sin que su dueño lo decida.",
        },
        {
          kind: "p",
          text: "Los mensajes de un intercambio y los mensajes directos se cifran en el navegador (ECDH P-256 + HKDF-SHA256 + AES-GCM-256 con AAD). El servidor guarda el sobre y la huella de la clave, y rechaza el texto plano si alguna de las partes tiene una clave publicada (409).",
        },
        {
          kind: "list",
          items: [
            "Un ejemplar solo se reserva si sigue `available`, dentro de la misma transacción.",
            "Al aceptar, las solicitudes rivales pasan a `expired`; solo el dueño acepta o rechaza.",
            "El cierre es bilateral: cada parte confirma por separado y solo la segunda confirmación completa el intercambio.",
            "El libro cambia de manos: el ejemplar entregado queda `given` y quien lo recibe estrena una copia en pausa en su estantería, que puede reactivar cuando quiera.",
            "Con una entrega confirmada ya no se puede cancelar: el ejemplar no vuelve al catálogo por detrás de quien ya ha declarado que lo entregó.",
            "La valoración (1–5 y comentario opcional) puntúa **a la persona** con la que intercambias, no al libro: una por parte y por intercambio, solo con el intercambio cerrado, y se ve en su perfil como media y comentarios.",
            "Las solicitudes sin respuesta caducan a los 14 días y avisan a quien esperaba.",
            "Bloqueos, cuentas suspendidas y ejemplares pausados se filtran en SQL, no en el cliente.",
          ],
        },
      ],
    },
    {
      id: "seguridad",
      heading: "Seguridad",
      blocks: [
        {
          kind: "list",
          items: [
            "Contraseñas con `scrypt` asíncrono y sal única; el acceso verifica siempre un hash (contra un señuelo si la cuenta no existe), así que el tiempo de respuesta no revela qué correos están registrados.",
            "Los mensajes de intercambio y directos van cifrados de extremo a extremo (ECDH P-256 + HKDF-SHA256 + AES-GCM). Cada cuenta publica **una clave por ranura** (`web` y `android`); el remitente guarda un sobre por cada clave del destinatario, así que el navegador y la app leen el mismo mensaje. Solo la primera clave de una cuenta se publica sin confirmación: en cuanto hay una ranura ocupada, tanto sustituirla como **añadir un dispositivo** exigen la contraseña, y cada cambio genera un aviso de seguridad.",
            "Sesión de 256 bits en cookie `httpOnly` con `SameSite=Lax`; en producción solo se acepta el prefijo `__Host-` y en la base solo vive su SHA-256.",
            "Verificación en dos pasos (TOTP RFC 6238, ventana de ±1 paso y anti-replay) obligatoria para moderar en producción; los secretos se guardan cifrados.",
            "Cuotas atómicas en base de datos por IP y por cuenta, con `429` y `Retry-After`.",
            "Todas las mutaciones pasan por `guard()` (origen y cuota) y `readJson()` exige `application/json` y corta los cuerpos de más de 64 KB.",
            "CSP con nonce y `strict-dynamic`, `X-Frame-Options: DENY`, COOP/CORP, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y HSTS en producción (`src/proxy.ts`).",
            "Directorio `0700` y base `0600`; `npm run db:backup` usa la API `.backup()` de SQLite y cifra con AES-256-GCM si existe `WANDERBIBLIOTHEK_BACKUP_KEY`.",
            "Registro con honeypot, tiempo mínimo y Cloudflare Turnstile opcional; mensaje genérico para no revelar correos registrados.",
            "Tokens de cuenta de un solo uso, hasheados y con caducidad; cambiar la contraseña revoca todas las sesiones.",
            "`GET /api/account/export` entrega todos los datos en JSON y borrar la cuenta elimina el contenido propio sin romper los hilos ajenos.",
          ],
        },
      ],
    },
    {
      id: "entorno",
      heading: "Variables de entorno",
      blocks: [
        {
          kind: "p",
          text: "Sin `APP_ENCRYPTION_KEY` no se guarda ningún secreto en claro: el alta falla con un error de configuración. En producción, `src/instrumentation.ts` revisa la configuración al arrancar y deja el motivo en el log.",
        },
        {
          kind: "table",
          head: ["Variable", "Por defecto", "Uso"],
          rows: [
            ["`WANDERBIBLIOTHEK_DB`", "`.data/wanderbibliothek.db`", "Ruta de la base SQLite (`:memory:` en las pruebas)."],
            ["`NEXT_PUBLIC_SITE_URL`", "`http://localhost:3000`", "Base de `sitemap.xml`, `robots.txt` y los canonical. Obligatoria en producción."],
            ["`APP_ENCRYPTION_KEY`", "sin definir", "32 bytes en hex o base64 para cifrar TOTP y datos de envío. Obligatoria."],
            ["`APP_ENCRYPTION_KEY_ID`", "derivado", "Nombre legible de la clave activa; si falta se usa un prefijo de su SHA-256."],
            ["`APP_ENCRYPTION_OLD_KEYS`", "vacío", "Claves anteriores solo para leer, mientras se completa una rotación."],
            ["`WANDERBIBLIOTHEK_ALLOW_PLAINTEXT`", "vacío", "Solo desarrollo: guarda secretos en claro si no hay clave."],
            ["`WANDERBIBLIOTHEK_BACKUP_KEY`", "sin definir", "Clave AES-256-GCM de las copias de seguridad."],
            ["`WANDERBIBLIOTHEK_BACKUP_KEEP`", "`14`", "Copias que se conservan al rotar."],
            ["`WANDERBIBLIOTHEK_BACKUP_HOOK`", "sin definir", "Comando que recibe `BACKUP_FILE` para la copia externa."],
            ["`WANDERBIBLIOTHEK_COVER_CACHE`", "junto a la base", "Carpeta de portadas descargadas y subidas."],
            ["`WANDERBIBLIOTHEK_SKIP_ENV_CHECK`", "sin definir", "Salta la comprobación de entorno del arranque."],
            ["`BREVO_API_KEY` / `MAIL_FROM`", "sin definir", "Envío directo por la API de Brevo, sin intermediario. `MAIL_FROM` admite `Nombre <correo@dominio>`; si también hay webhook, manda el webhook."],
            ["`MAIL_WEBHOOK_URL`", "sin definir", "Recibe `{to, subject, text}`; los envíos pasan por `mail_outbox` con reintentos."],
            ["`MAIL_WEBHOOK_TOKEN`", "sin definir", "Autenticación `Bearer` del webhook de correo."],
            ["`MAINTENANCE_TOKEN`", "sin definir", "Token del cron `POST /api/cron/maintenance`; sin él, 404."],
            ["`AUDIT_RETENTION_DAYS`", "`730`", "Días que se conserva `admin_audit` (0 = para siempre)."],
            ["`ADMIN_EMAIL` / `ADMIN_PASSWORD`", "sin definir", "Crean el primer administrador si no existe ninguno."],
            ["`REQUIRE_EMAIL_VERIFICATION`", "sin definir", "`1` exige el correo confirmado para publicar, solicitar, comentar y escribir."],
            ["`NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET`", "sin definir", "Activan Cloudflare Turnstile en el registro."],
            ["`ERROR_WEBHOOK_URL` / `ERROR_WEBHOOK_TOKEN`", "sin definir", "Reciben los errores 500 en JSON (Sentry, Logtail o webhook propio)."],
            ["`TRUST_PROXY`", "sin definir", "`1` solo con un proxy propio delante: autoriza `X-Forwarded-For`/`-Host` y activa las cuotas por IP."],
            ["`LEGAL_CONTROLLER` / `LEGAL_ADDRESS` / `LEGAL_CONTACT_EMAIL`", "sin definir", "Rellenan `/privacidad` y `/aviso-legal`."],
            ["`LEGAL_VAT_ID` / `LEGAL_PHONE` / `LEGAL_REGISTER`", "sin definir", "Datos opcionales del aviso legal."],
            ["`SEED_DEMO`", "`1` fuera de producción", "Siembra los datos de demostración; en producción solo con `1` explícito."],
            ["`GOOGLE_BOOKS_API_KEY`", "sin definir", "Sube la cuota de Google Books para las portadas."],
            [
              "`MASTODON_TOKEN`",
              "sin definir",
              "Activa el bot que anuncia en Mastodon las obras que publica una cuenta de administración (las de la comunidad no llegan a la cola); sin él no se encola ni se publica nada. Un aviso por obra y cuenta y día; si se publican varias de golpe, el primero sale en el acto y los demás se encolan con una separación aleatoria de 2 a 3 horas (la administración, además, no tiene tope diario).",
            ],
            [
              "`MASTODON_LIKES` / `MASTODON_LIKES_PER_DAY` / `MASTODON_LIKES_MIN_GAP_MINUTES`",
              "apagado / 40 / 25",
              "Enciende los «me gusta» a publicaciones sobre libros: tope en 24 h, separación mínima y `MASTODON_LIKES_TAGS` para etiquetas propias. Mira los tres idiomas (de, es, en) y solo cuentas que hablan de libros en su biografía (`MASTODON_LIKES_LOCALES`, `MASTODON_LIKES_PER_ACCOUNT`). Necesita `write:favourites` en el token.",
            ],
            [
              "`MASTODON_QUIET_HOURS`",
              "`22-9`",
              "Ventana de silencio en hora de Berlín: entre la hora de inicio y la de fin no salen avisos ni «me gusta»; lo que vence se queda en cola hasta las 09:00. `off` la desactiva y `1-5` (sin cruzar la medianoche) también vale.",
            ],
          ],
        },
      ],
    },
    {
      id: "pruebas",
      heading: "Pruebas e integración continua",
      blocks: [
        {
          kind: "p",
          text: "`npm test` ejecuta 663 pruebas unitarias y de integración en 82 ficheros (runner de Node sobre SQLite en memoria) y `npm run test:e2e` añade 36 pruebas de navegador con Playwright, que arranca su propio servidor en el puerto 3100.",
        },
        {
          kind: "p",
          text: "`npm run test:coverage` aplica umbrales mínimos del 92 % de líneas, 80 % de ramas y 88 % de funciones. La integración continua (`.github/workflows/ci.yml`) ejecuta `lint`, `typecheck`, `test`, `build`, `npm audit --omit=dev`, las pruebas de navegador y un build de la imagen Docker sin publicarla.",
        },
        {
          kind: "code",
          lines: [
            "npm install",
            "npm run lint && npm run typecheck && npm test",
            "npm run build",
            "npx playwright install chromium && npm run test:e2e",
          ],
        },
      ],
    },
    {
      id: "operacion",
      heading: "Operación",
      blocks: [
        {
          kind: "list",
          items: [
            "`npm run db:backup` usa la API `.backup()` de SQLite, comprueba la integridad, rota las copias, cifra si hay clave y lanza `WANDERBIBLIOTHEK_BACKUP_HOOK`. Nunca copies el fichero en caliente con WAL activo.",
            "`POST /api/cron/maintenance` con `Authorization: Bearer $MAINTENANCE_TOKEN` caduca solicitudes, purga sesiones, avisos y cuotas, borra la actividad vieja (`events` y `product_events`, 180 días) y la auditoría de moderación según `AUDIT_RETENTION_DAYS`, y envía los recordatorios de los clubes.",
            "`npm run user:verify -- <correo>` y `npm run admin:2fa-off -- <correo>` son las salidas de emergencia cuando el correo o el segundo factor dejan a alguien fuera.",
            "Cada respuesta lleva `x-request-id` y `x-response-time`, y cada petición deja una línea `[req] {…}` en el registro. El `reference` que devuelve un 500 son los 8 primeros caracteres de ese id.",
            "Una sola instancia: SQLite tiene un único escritor y el bus de avisos vive en memoria. Escalar exige PostgreSQL y Redis/pubsub.",
            "Techo medido con `npm run bench:sqlite`: unas 99 000 escrituras/s sueltas, 250 000/s en lote, 350 000 lecturas/s por clave primaria y 2 000/s en un filtro sin índice sobre 5 000 filas. El límite real es la duración de cada transacción, no el número de visitas.",
          ],
        },
        {
          kind: "p",
          text: "Los secretos se guardan como `enc:v2:<clave>:<flags>:<iv>.<tag>.<datos>`. Para cambiar de clave sin perder nada:",
        },
        {
          kind: "code",
          lines: [
            "# 1. Ensayo: la nueva entra como activa y la vieja queda para leer",
            "APP_ENCRYPTION_KEY=<nueva> APP_ENCRYPTION_OLD_KEYS=<vieja> \\",
            "  npm run rotate:secrets -- --dry-run",
            "",
            "# 2. Cuando el informe cuadre, sin --dry-run",
            "APP_ENCRYPTION_KEY=<nueva> APP_ENCRYPTION_OLD_KEYS=<vieja> \\",
            "  npm run rotate:secrets",
            "",
            "# 3. Retira APP_ENCRYPTION_OLD_KEYS",
          ],
        },
      ],
    },
    {
      id: "despliegue",
      heading: "Despliegue",
      blocks: [
        {
          kind: "list",
          items: [
            "La guía completa (usuario de sistema, systemd, nginx, TLS, timers y restauración) está en `deploy/README.md`.",
            "`deploy/wanderbibliothek.service`, `deploy/nginx.conf` y `deploy/env.example`: la aplicación escucha en `127.0.0.1:3000` y nginx pone el TLS, con `/api/requests/` sin buffering para que el canal SSE no se corte.",
            "`deploy/wanderbibliothek-maintenance.timer` (cada 15 minutos) y `deploy/wanderbibliothek-backup.timer` (diario).",
            "También hay `Dockerfile` y `docker-compose.yml` multi-etapa con solo dependencias de producción; el build de la imagen se valida en la integración continua.",
            "Si falta algo grave en la configuración, el proceso arranca pero responde 500 a todo con el motivo en el log, en lugar de parecer que funciona.",
            "`tsx` es dependencia de producción: lo usan `admin:create`, `db:backup`, `user:verify` y `smoke`, también dentro de la imagen con `npm ci --omit=dev`.",
          ],
        },
      ],
    },
    {
      id: "interfaz",
      heading: "Interfaz y accesibilidad",
      blocks: [
        {
          kind: "list",
          items: [
            "Un solo armazón (`SiteShell`) para las páginas internas; la portada es la excepción y deja el catálogo a todo el ancho libre.",
            "Los colores salen de tokens (`src/app/styles/tokens.css`): fuera de ese fichero no hay literales, así que el modo claro y el oscuro comparten el mismo marcado.",
            "Cuatro breakpoints (480, 768, 1120 y 1400/1800 px), escala de espacio de 4 a 48 px y controles de 40 px, 44 en móvil.",
            "Diálogos con foco atrapado, cierre con `Escape` y restauración del foco; enlace «Saltar al contenido», `aria-current` en la navegación, filtros con `aria-pressed` y errores con `role=\"alert\"`.",
            "Contraste mínimo AA, tipografía desde 12 px, objetivos táctiles de 44 px en móvil y `prefers-reduced-motion` respetado.",
            "La interfaz es trilingüe y cada idioma tiene su propia URL: el alemán es el de por defecto y va sin prefijo (`/werk/x`), mientras que el castellano y el inglés se publican en `/es/…` y `/en/…`, con `hreflang` y canonical propios para que los buscadores los indexen por separado. Dentro de una URL con prefijo manda el prefijo; si no lo hay manda el selector, que guarda la cookie `wanderbibliothek-locale` y, si hay sesión, la preferencia de la cuenta para los avisos y el correo; sin preferencia se usa el idioma del navegador (`Accept-Language`) y, si no hay ninguno de los tres, el alemán.",
          ],
        },
      ],
    },
    {
      id: "enlaces",
      heading: "Más documentación",
      blocks: [
        {
          kind: "links",
          items: [
            {
              label: "Repositorio",
              href: REPOSITORY,
              note: "Código fuente, historial y avisos privados de vulnerabilidad.",
            },
            {
              label: "DOCUMENTATION.md",
              href: `${REPOSITORY}/blob/main/DOCUMENTATION.md`,
              note: "Esta misma página en inglés, dentro del repositorio.",
            },
            {
              label: "CONTRIBUTING.md",
              href: `${REPOSITORY}/blob/main/CONTRIBUTING.md`,
              note: "Entorno, comandos de calidad, convenciones de commits y reglas de migración.",
            },
            {
              label: "SECURITY.md",
              href: `${REPOSITORY}/blob/main/SECURITY.md`,
              note: "Cómo reportar una vulnerabilidad y buenas prácticas de autohospedaje.",
            },
            {
              label: "deploy/README.md",
              href: `${REPOSITORY}/blob/main/deploy/README.md`,
              note: "Despliegue paso a paso con systemd, nginx y TLS.",
            },
            {
              label: "LICENSE",
              href: `${REPOSITORY}/blob/main/LICENSE`,
              note: "Licencia MIT.",
            },
            {
              label: "NOTICE",
              href: `${REPOSITORY}/blob/main/NOTICE`,
              note: "Atribuciones de la fotografía de portada y de la tipografía.",
            },
          ],
        },
      ],
    },
  ],
};

const DE: TechnicalDocument = {
  title: "Technische Dokumentation",
  updated: UPDATED,
  intro: [
    "Wie Wanderbibliothek gebaut ist: Architektur, Routen, Daten, Sicherheit und Betrieb. Gedacht für alle, die den Code lesen, die Anwendung betreiben oder prüfen wollen, was gespeichert wird.",
    "Alles hier Beschriebene steht im Repository. Ändert sich der Code, ändert sich diese Seite mit.",
  ],
  sections: [
    {
      id: "ueberblick",
      heading: "Überblick",
      blocks: [
        {
          kind: "p",
          text: "Modularer Monolith mit Next.js 16 (App Router mit Cache Components), strengem TypeScript und SQLite über `better-sqlite3`. Ein einziger Prozess: SQLite kennt nur einen Schreiber, und der Live-Bus für Hinweise liegt im Speicher.",
        },
        {
          kind: "p",
          text: "Es gibt keine verpflichtenden Fremddienste. Cover und bibliografische Daten holt der Server und legt sie auf der Platte ab, sodass der Browser nie mit Dritten spricht.",
        },
        {
          kind: "p",
          text: "Der Code steht unter der MIT-Lizenz. Diese Seite beschreibt den Code der Instanz, die sie ausliefert.",
        },
      ],
    },
    {
      id: "architektur",
      heading: "Architektur",
      blocks: [
        {
          kind: "code",
          lines: [
            "src/",
            "  app/                 Seiten und Route Handler (App Router)",
            "    api/               72 Handler, nach Domäne gruppiert",
            "    styles/            Tokens, Typografie, Struktur, Karten, Dialoge, Detailseiten",
            "    proxy.ts           CSP mit Nonce und Sicherheits-Header",
            "  components/          Server-Gerüst und interaktive Inseln",
            "  lib/",
            "    db/                Verbindung, Basisschema (v2), Migrationen (v3–v45), Seed",
            "    repo/              SQL-Abfragen je Domäne; `repo.ts` reexportiert nur",
            "    validation.ts      Zod-Schemata mit übersetzten Meldungen",
            "    secret-box.ts      umkehrbare Verschlüsselung mit Schlüsselring (TOTP)",
            "    e2e.ts             Ende-zu-Ende-Verschlüsselung (ECDH + HKDF + AES-GCM)",
            "    route.ts           Routen-Wrapper: Sitzung, Body, Kontingent, Fehler",
            "tests/                 663 Unit- und Integrationstests (82 Dateien)",
            "e2e/                   Browser-Tests mit Playwright (6 Dateien)",
            "deploy/                systemd, nginx, Umgebungsvorlage und Anleitung",
          ],
        },
        {
          kind: "p",
          text: "Das Gerüst (`site-shell.tsx`, `site-rail.tsx`) ist ein Server Component: Seitenleiste, Kopfzeile, Fußzeile und mobile Navigation kommen fertig gerendert an, hydratisiert werden nur die interaktiven Inseln (`account-menu`, `theme-toggle`, `locale-switcher`, `verify-email-banner`).",
        },
        {
          kind: "p",
          text: "Das deutsche Wörterbuch geht nicht an den Browser: `i18n.ts` wird nur auf dem Server importiert, und das Layout gibt dem Client-Provider nur die Texte der aktiven Sprache, nicht das ganze Wörterbuch. Sie sind außerdem über eine 32-Bit-Kennung (`messageId`) adressiert statt über den Quelltext: der Schlüssel ist zehn Ziffern lang und der spanische Text reist nicht mit, was das deutsche HTML von 236 auf 182 KB bringt.",
        },
        {
          kind: "p",
          text: "`getDb()` hängt sich in `prepare` und verwendet kompilierte Anweisungen weiter (FIFO-Cache mit 400 Einträgen je Verbindung). Öffentliche Aggregate laufen über `use cache` mit dem Tag `public-data`, das die schreibenden Routen entwerten.",
        },
        {
          kind: "p",
          text: "Das Rendering liest weder `Date.now()` noch `new Date()`: Next wertet das beim Vorab-Rendern als instabilen Wert. Zeitstempel für Hinweise, Wartung und Limits setzt SQLite mit `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.",
        },
      ],
    },
    {
      id: "routen",
      heading: "Routen",
      blocks: [
        {
          kind: "p",
          text: "Die internen Seiten verlangen eine Sitzung; ohne sie leiten sie auf `/?auth=1&next=…` um. Öffentlich sind nur die Startseite, die Rechtstexte, die Abläufe mit eigenem Link und diese Dokumentation. `robots.txt` sperrt Katalog und Profile, damit Name und Stadt der Leser:innen nicht in Suchmaschinen landen.",
        },
        {
          kind: "table",
          head: ["Route", "Inhalt"],
          rows: [
            ["`/`", "Öffentliche Startseite: Hero, vier Kennzahlen und eine Reihe Bücher."],
            ["`/descubrir`", "Vollständiger Katalog mit Suche, Kategorien, Sortierung und Seitenzahl in der URL. Ohne Sitzung sichtbar; zum Anfragen braucht es eine."],
            ["`/werk/[id]`", "Öffentliche Werkseite mit JSON-LD `Book`/`Offer`: die URL, die indexiert wird."],
            ["`/ofrecer`", "Ein Exemplar einstellen: die ISBN füllt die bibliografischen Daten."],
            ["`/buscar`", "Globale Suche: Werke, Clubs, Leser:innen und Listen."],
            ["`/estanteria`, `/intercambios`", "Private Bereiche: eigene Exemplare und Anfragen mit dem nächsten Schritt."],
            ["`/comunidad`", "Hub mit Tabs (Gespräche, Aktivität, Clubs, Leser:innen, Listen) und Umfang über `?scope=`."],
            ["`/lectores`", "Verzeichnis mit Suche, Stadt und Sortierung nach Nähe oder Aktivität."],
            ["`/clubes`, `/clubes/[clubId]`", "Clubs je Stadt: Anfragen, laufende Lektüre, Abstimmung, Teilnahme und privates Forum."],
            ["`/listas`, `/listas/[listId]`", "Leselisten: ohne Sitzung lesbar (die Unterschrift erscheint nur mit Zustimmung), bearbeitbar nur von der Eigentümerin."],
            ["`/libro/[id]`", "Exemplarseite mit Metadaten und JSON-LD `Book`/`Offer`."],
            ["`/obra/[bookId]`", "Kanonisches Werk: Gespräch zum Titel, Exemplare und Empfehlungen."],
            ["`/u/[id]`", "Öffentliches Profil: Biografie, Kennzahlen, Rezensionen, Regal und Folgen."],
            ["`/cuenta`", "Einstellungen: Profil, Hinweise, Passwort, Verschlüsselung, zweiter Faktor, Export und Löschung."],
            ["`/admin`", "Moderation der Community; verlangt einen aktiven zweiten Faktor."],
            ["`/privacidad`, `/aviso-legal`", "Datenschutzerklärung (Art. 13 DSGVO) und Impressum (§ 5 DDG)."],
            ["`/verificar`, `/restablecer`", "E-Mail bestätigen und neues Passwort über den Link setzen."],
            ["`/documentacion`", "Diese Seite."],
            ["`/projekt`", "Was das Projekt ist, warum es existiert, dass es keinen kommerziellen Zweck hat und was es zeigt."],
            ["`/api/health`", "Zustand von Dienst und Datenbank."],
            ["`/sitemap.xml`, `/robots.txt`", "Indexierung: die Sitemap veröffentlicht Startseite, Werkseiten und Infoseiten **in allen drei Sprachen** (mit `xhtml:link`); IndexNow benachrichtigt Bing — und damit DuckDuckGo und Ecosia —, sobald ein Buch eingestellt wird."],
          ],
        },
        {
          kind: "p",
          text: "Die API besteht aus 72 Handlern unter `src/app/api`. Fast alle werden mit `route()` (`src/lib/route.ts`) deklariert, das an einer Stelle Sitzung, Zod-Schema des Bodys, Kontingent mit Herkunftsprüfung und `handleApiError()` anwendet; `tests/route.test.ts` prüft an den Dateien, dass keine Route Fehler unübersetzt durchlässt.",
        },
        {
          kind: "list",
          items: [
            "`/api/auth/*`: Registrierung, Anmeldung, Abmeldung, Sitzung, Bestätigung und Zurücksetzen mit Einmal-Tokens.",
            "`/api/listings`, `/api/listings/[id]`, `…/favorite`: Exemplare einstellen, bearbeiten, zurückziehen und merken.",
            "`/api/requests`, `/api/requests/[id]` und Ableger (`events` per SSE, `messages`, `read`, `review`): der ganze Tauschablauf.",
            "`/api/books/*`: Werksuche, Kommentare, Likes, Hinweise je Werk und Lesestände.",
            "`/api/clubs/*`: Club, Mitglieder, Moderator:innen, Einladungen, Teilnahme, Übergabe, Forum, Abstimmungen und Beitrittsanfragen.",
            "`/api/lists/*`, `/api/direct/*`, `/api/users/[userId]/follow`, `/api/blocks`: Listen, verschlüsselte Direktnachrichten, Folgen und Blockieren.",
            "`/api/account/*`: Profil, Sprache, Passwort, Verschlüsselungsschlüssel, TOTP, Export und Löschung.",
            "`/api/admin/*`, `/api/reports`, `/api/comments/[id]`, `/api/notifications`: Meldungen, Moderation, Kommentare und Hinweise.",
            "`/api/cover/*`, `/api/isbn/[isbn]`: zwischengespeicherte Cover und bibliografische Daten (DNB und Open Library).",
            "`/api/cron/maintenance`: geplante Aufgaben mit `MAINTENANCE_TOKEN`: wiederholt die Mastodon-Hinweise, räumt Altes auf und gibt, mit `MASTODON_LIKES=on`, ein paar wenige, gut verteilte «Gefällt mir» für Buchbeiträge.",
          ],
        },
      ],
    },
    {
      id: "daten",
      heading: "Daten",
      blocks: [
        {
          kind: "list",
          items: [
            "`books` ist die Ausgabe (eindeutige ISBN), `listings` das konkrete Exemplar; `books.work_key` bündelt Ausgaben desselben Werks, sodass sie Gespräch und Exemplarliste teilen.",
            "Zustände eines Exemplars: `available`, `reserved`, `given`, `paused`, `removed`.",
            "Zustände einer Anfrage: `pending`, `accepted`, `declined`, `cancelled`, `completed`, `expired`.",
            "Suche über FTS5 (`listings_fts`), von Triggern gepflegt; `unaccent()` faltet Akzente, damit „Lucía“ auch als „lucia“ gefunden wird.",
            "`cities` hält die bekannten Städte mit ihren Koordinaten (der deutsche Grundstock), `city_distances` deren Distanzmatrix. Die eingegebene Stadt wird gegen OpenStreetMap geprüft: `resolveCity()` fragt Nominatim, begrenzt auf europäische Länder, und speichert den Namen, den die Karte kennt. Die Entfernung ist Nebensache: eine Stadt außerhalb der Liste zeigt keine Kilometer.",
          ],
        },
        {
          kind: "p",
          text: "Migrationen werden über `PRAGMA user_version` versioniert (aktuell: v45) und erhalten die Daten einer bestehenden Installation. Die v40 gibt jedem Gerät seinen eigenen Schlüssel-Slot (`web` und `android`) und speichert pro Empfängerschlüssel einen verschlüsselten Umschlag, sodass Browser und App dieselben Nachrichten lesen; die v38 öffnet den Katalog wieder für alle Städte, ergänzt `requests.ship_kind` und `ship_street`, verschlüsselt die Versanddaten, die die v37 im Klartext abgelegt hat, und entfernt die Deutsche-Post-Filialen; die v36 brachte die verschlüsselten Direktnachrichten, die v37 den Versand per Post. Die folgenden drei (v41–v43) legen die Social-Ausgangsablage (`social_outbox`) an und ergänzen das Bild der Meldung und die Tagesgrenze je Konto; die v44 schließt den Kreis des Tauschs: das übergebene Exemplar bleibt `given` und wer es bekommt, bekommt ein eigenes; die v45 legt `social_likes` an, das Gedächtnis der «Gefällt mir» des Bots.",
        },
        {
          kind: "p",
          text: "Die Spalten für Übergabe und Versand (`handover_code`, `handover_method`, `ship_kind`, `ship_number`, `ship_station`, `ship_street`, `ship_postal_code`, `ship_city`) bleiben in der Datenbank, damit nichts Gespeichertes verloren geht, aber kein Code schreibt oder liest sie mehr: die Übergabe wird im Gespräch zum Tausch vereinbart und jede Seite bestätigt in der Plattform, wenn sie das Buch hat – ohne Code und ohne Adressen.",
        },
        {
          kind: "p",
          text: "Ein Tausch lässt das Buch nicht verwaisen: beim Abschluss bleibt das übergebene Exemplar `given` (das ist der Verlauf) und wer es bekommt, bekommt **ein eigenes Exemplar** – dieselbe Ausgabe, derselbe Zustand, seine Stadt und pausiert (`listings.from_listing_id` und `from_request_id` halten die Spur). Aus seinem Regal kann er es aktivieren, und das Buch wandert weiter; hatte die Moderation das ursprüngliche Exemplar entfernt, entsteht die Kopie trotzdem und nichts kehrt ohne seinen Willen in den Katalog zurück.",
        },
        {
          kind: "p",
          text: "Nachrichten eines Tauschs und Direktnachrichten werden im Browser verschlüsselt (ECDH P-256 + HKDF-SHA256 + AES-GCM-256 mit AAD). Der Server speichert den Umschlag und den Schlüssel-Fingerabdruck und lehnt Klartext ab, sobald eine der beiden Seiten einen Schlüssel veröffentlicht hat (409).",
        },
        {
          kind: "list",
          items: [
            "Ein Exemplar wird nur reserviert, wenn es noch `available` ist – innerhalb derselben Transaktion.",
            "Beim Annehmen wandern konkurrierende Anfragen nach `expired`; annehmen oder ablehnen kann nur die Eigentümer:in.",
            "Der Abschluss ist beidseitig: jede Seite bestätigt getrennt, und erst die zweite Bestätigung schließt den Tausch.",
            "Das Buch wechselt den Besitz: das übergebene Exemplar bleibt `given` und wer es bekommt, hat ein pausiertes Exemplar in seinem Regal, das er jederzeit aktivieren kann.",
            "Ist eine Übergabe bestätigt, lässt sich der Tausch nicht mehr abbrechen: das Exemplar kehrt nicht hinter dem Rücken der Person in den Katalog zurück, die die Übergabe schon erklärt hat.",
            "Die Bewertung (1–5 und optionaler Kommentar) gilt **der Person**, mit der du tauschst, nicht dem Buch: eine je Seite und Tausch, nur nach Abschluss, und sie erscheint in ihrem Profil als Durchschnitt und Kommentar.",
            "Unbeantwortete Anfragen verfallen nach 14 Tagen und benachrichtigen die wartende Person.",
            "Blockierungen, gesperrte Konten und pausierte Exemplare werden in SQL gefiltert, nicht im Client.",
          ],
        },
      ],
    },
    {
      id: "sicherheit",
      heading: "Sicherheit",
      blocks: [
        {
          kind: "list",
          items: [
            "Passwörter mit asynchronem `scrypt` und eigenem Salt; die Anmeldung prüft immer einen Hash (gegen einen Köder, wenn es das Konto nicht gibt), sodass die Antwortzeit nicht verrät, welche Adressen registriert sind.",
            "Tausch- und Direktnachrichten sind Ende-zu-Ende verschlüsselt (ECDH P-256 + HKDF-SHA256 + AES-GCM). Jedes Konto veröffentlicht **einen Schlüssel pro Geräte-Slot** (`web` und `android`); der Absender speichert pro Empfängerschlüssel einen Umschlag, sodass Browser und App dieselbe Nachricht lesen. Nur der erste Schlüssel eines Kontos wird ohne Bestätigung veröffentlicht: Sobald ein Slot belegt ist, verlangt sowohl das Ersetzen als auch das **Hinzufügen eines Geräts** das Kontopasswort, und jede Änderung erzeugt einen Sicherheitshinweis.",
            "Sitzung mit 256 Bit im `httpOnly`-Cookie und `SameSite=Lax`; in Produktion wird nur das Präfix `__Host-` akzeptiert, und in der Datenbank liegt nur ihr SHA-256.",
            "Zweiter Faktor (TOTP nach RFC 6238, Fenster ±1 Schritt, Anti-Replay) ist für Moderation in Produktion Pflicht; die Geheimnisse liegen verschlüsselt.",
            "Atomare Kontingente in der Datenbank je IP und je Konto, mit `429` und `Retry-After`.",
            "Alle schreibenden Zugriffe laufen über `guard()` (Herkunft und Kontingent), und `readJson()` verlangt `application/json` und kappt Bodys über 64 KB.",
            "CSP mit Nonce und `strict-dynamic`, `X-Frame-Options: DENY`, COOP/CORP, `nosniff`, `Referrer-Policy`, `Permissions-Policy` und HSTS in Produktion (`src/proxy.ts`).",
            "Verzeichnis `0700` und Datenbank `0600`; `npm run db:backup` nutzt die `.backup()`-API von SQLite und verschlüsselt mit AES-256-GCM, wenn `WANDERBIBLIOTHEK_BACKUP_KEY` gesetzt ist.",
            "Registrierung mit Honeypot, Mindestzeit und optionalem Cloudflare Turnstile; die Antwort ist allgemein gehalten, um keine Adressen zu verraten.",
            "Konto-Tokens sind einmalig, gehasht und befristet; ein Passwortwechsel beendet alle Sitzungen.",
            "`GET /api/account/export` liefert alle Daten als JSON, und das Löschen des Kontos entfernt eigene Inhalte, ohne fremde Gespräche zu zerreißen.",
          ],
        },
      ],
    },
    {
      id: "umgebung",
      heading: "Umgebungsvariablen",
      blocks: [
        {
          kind: "p",
          text: "Ohne `APP_ENCRYPTION_KEY` wird kein Geheimnis im Klartext abgelegt: das Anlegen scheitert mit einem Konfigurationsfehler. In Produktion prüft `src/instrumentation.ts` die Konfiguration beim Start und schreibt den Grund ins Log.",
        },
        {
          kind: "table",
          head: ["Variable", "Standard", "Zweck"],
          rows: [
            ["`WANDERBIBLIOTHEK_DB`", "`.data/wanderbibliothek.db`", "Pfad der SQLite-Datenbank (`:memory:` in Tests)."],
            ["`NEXT_PUBLIC_SITE_URL`", "`http://localhost:3000`", "Basis für `sitemap.xml`, `robots.txt` und Canonicals. In Produktion Pflicht."],
            ["`APP_ENCRYPTION_KEY`", "nicht gesetzt", "32 Byte in Hex oder Base64 für TOTP und Versanddaten. Pflicht."],
            ["`APP_ENCRYPTION_KEY_ID`", "abgeleitet", "Lesbarer Name des aktiven Schlüssels; fehlt er, dient ein Präfix seines SHA-256."],
            ["`APP_ENCRYPTION_OLD_KEYS`", "leer", "Frühere Schlüssel nur zum Lesen, solange eine Rotation läuft."],
            ["`WANDERBIBLIOTHEK_ALLOW_PLAINTEXT`", "leer", "Nur Entwicklung: legt Geheimnisse im Klartext ab, wenn kein Schlüssel da ist."],
            ["`WANDERBIBLIOTHEK_BACKUP_KEY`", "nicht gesetzt", "AES-256-GCM-Schlüssel der Sicherungen."],
            ["`WANDERBIBLIOTHEK_BACKUP_KEEP`", "`14`", "Anzahl der Sicherungen, die beim Rotieren bleiben."],
            ["`WANDERBIBLIOTHEK_BACKUP_HOOK`", "nicht gesetzt", "Befehl, der `BACKUP_FILE` für eine externe Kopie erhält."],
            ["`WANDERBIBLIOTHEK_COVER_CACHE`", "neben der Datenbank", "Ordner für geladene und hochgeladene Cover."],
            ["`WANDERBIBLIOTHEK_SKIP_ENV_CHECK`", "nicht gesetzt", "Überspringt die Umgebungsprüfung beim Start."],
            ["`BREVO_API_KEY` / `MAIL_FROM`", "nicht gesetzt", "Direktversand über die Brevo-API ohne Zwischenstelle. `MAIL_FROM` erlaubt `Name <adresse@domain>`; gibt es zusätzlich einen Webhook, gilt der Webhook."],
            ["`MAIL_WEBHOOK_URL`", "nicht gesetzt", "Empfängt `{to, subject, text}`; Versand läuft über `mail_outbox` mit Wiederholungen."],
            ["`MAIL_WEBHOOK_TOKEN`", "nicht gesetzt", "`Bearer`-Authentifizierung des Mail-Webhooks."],
            ["`MAINTENANCE_TOKEN`", "nicht gesetzt", "Token für `POST /api/cron/maintenance`; ohne ihn 404."],
            ["`AUDIT_RETENTION_DAYS`", "`730`", "Tage, die `admin_audit` aufbewahrt wird (0 = dauerhaft)."],
            ["`ADMIN_EMAIL` / `ADMIN_PASSWORD`", "nicht gesetzt", "Legen das erste Verwaltungskonto an, wenn keines existiert."],
            ["`REQUIRE_EMAIL_VERIFICATION`", "nicht gesetzt", "`1` verlangt eine bestätigte Adresse zum Einstellen, Anfragen, Kommentieren und Schreiben."],
            ["`NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET`", "nicht gesetzt", "Aktivieren Cloudflare Turnstile bei der Registrierung."],
            ["`ERROR_WEBHOOK_URL` / `ERROR_WEBHOOK_TOKEN`", "nicht gesetzt", "Empfangen 500er als JSON (Sentry, Logtail oder eigener Webhook)."],
            ["`TRUST_PROXY`", "nicht gesetzt", "`1` nur mit eigenem Proxy davor: erlaubt `X-Forwarded-For`/`-Host` und aktiviert Kontingente je IP."],
            ["`LEGAL_CONTROLLER` / `LEGAL_ADDRESS` / `LEGAL_CONTACT_EMAIL`", "nicht gesetzt", "Füllen `/privacidad` und `/aviso-legal`."],
            ["`LEGAL_VAT_ID` / `LEGAL_PHONE` / `LEGAL_REGISTER`", "nicht gesetzt", "Optionale Angaben für das Impressum."],
            ["`SEED_DEMO`", "`1` außerhalb der Produktion", "Legt Demodaten an; in Produktion nur mit ausdrücklicher `1`."],
            ["`GOOGLE_BOOKS_API_KEY`", "nicht gesetzt", "Erhöht das Kontingent von Google Books für Cover."],
            [
              "`MASTODON_TOKEN`",
              "nicht gesetzt",
              "Aktiviert den Bot, der auf Mastodon die Werke ankündigt, die ein Administrationskonto veröffentlicht (Werke aus der Community erreichen die Warteschlange nicht); ohne ihn wird nichts eingereiht oder veröffentlicht. Ein Hinweis pro Werk und Konto und Tag; bei mehreren auf einmal geht der erste sofort raus und die übrigen warten mit einem zufälligen Abstand von 2 bis 3 Stunden (die Administration hat außerdem keine Tagesgrenze).",
            ],
            [
              "`MASTODON_LIKES` / `MASTODON_LIKES_PER_DAY` / `MASTODON_LIKES_MIN_GAP_MINUTES`",
              "aus / 40 / 25",
              "Schaltet «Gefällt mir» für Buchbeiträge ein: Tagesgrenze, Mindestabstand und `MASTODON_LIKES_TAGS` für eigene Hashtags. Sieht alle drei Sprachen (de, es, en) und nur Konten, die in ihrer Biografie von Büchern sprechen (`MASTODON_LIKES_LOCALES`, `MASTODON_LIKES_PER_ACCOUNT`). Braucht `write:favourites` im Token.",
            ],
            [
              "`MASTODON_QUIET_HOURS`",
              "`22-9`",
              "Ruhefenster in Berliner Zeit: zwischen Start- und Endstunde gehen weder Hinweise noch «Gefällt mir» raus; was fällig wird, wartet bis 09:00. `off` schaltet es ab, `1-5` (ohne Mitternacht) gilt auch.",
            ],
          ],
        },
      ],
    },
    {
      id: "tests",
      heading: "Tests und Continuous Integration",
      blocks: [
        {
          kind: "p",
          text: "`npm test` führt 663 Unit- und Integrationstests in 82 Dateien aus (Node-Testrunner auf SQLite im Speicher), und `npm run test:e2e` ergänzt 36 Browser-Tests mit Playwright, die ihren eigenen Server auf Port 3100 starten.",
        },
        {
          kind: "p",
          text: "`npm run test:coverage` setzt Mindestschwellen von 92 % Zeilen, 80 % Zweigen und 88 % Funktionen. Die Continuous Integration (`.github/workflows/ci.yml`) führt `lint`, `typecheck`, `test`, `build`, `npm audit --omit=dev`, die Browser-Tests und einen Build des Docker-Images ohne Veröffentlichung aus.",
        },
        {
          kind: "code",
          lines: [
            "npm install",
            "npm run lint && npm run typecheck && npm test",
            "npm run build",
            "npx playwright install chromium && npm run test:e2e",
          ],
        },
      ],
    },
    {
      id: "betrieb",
      heading: "Betrieb",
      blocks: [
        {
          kind: "list",
          items: [
            "`npm run db:backup` nutzt die `.backup()`-API von SQLite, prüft die Integrität, rotiert die Sicherungen, verschlüsselt bei vorhandenem Schlüssel und startet `WANDERBIBLIOTHEK_BACKUP_HOOK`. Die Datei nie bei aktivem WAL im laufenden Betrieb kopieren.",
            "`POST /api/cron/maintenance` mit `Authorization: Bearer $MAINTENANCE_TOKEN` lässt Anfragen verfallen, räumt Sitzungen, Hinweise und Kontingente auf und verschickt die Erinnerungen der Clubs.",
            "`npm run user:verify -- <adresse>` und `npm run admin:2fa-off -- <adresse>` sind die Notausgänge, wenn Mail oder zweiter Faktor jemanden aussperren.",
            "Jede Antwort trägt `x-request-id` und `x-response-time`, und jede Anfrage hinterlässt eine Zeile `[req] {…}` im Log. Die `reference` eines 500ers sind die ersten 8 Zeichen dieser ID.",
            "Nur eine Instanz: SQLite hat einen einzigen Schreiber, und der Hinweis-Bus liegt im Speicher. Skalierung verlangt PostgreSQL und Redis/Pubsub.",
            "Gemessene Obergrenze mit `npm run bench:sqlite`: rund 99 000 Einzel-Schreibvorgänge/s, 250 000/s im Stapel, 350 000 Lesezugriffe/s über den Primärschlüssel und 2 000/s bei einem Filter ohne Index über 5 000 Zeilen. Die echte Grenze ist die Dauer jeder Transaktion, nicht die Zahl der Aufrufe.",
          ],
        },
        {
          kind: "p",
          text: "Geheimnisse liegen als `enc:v2:<schlüssel>:<flags>:<iv>.<tag>.<daten>` vor. Schlüsselwechsel ohne Datenverlust:",
        },
        {
          kind: "code",
          lines: [
            "# 1. Probelauf: der neue Schlüssel ist aktiv, der alte bleibt zum Lesen",
            "APP_ENCRYPTION_KEY=<neu> APP_ENCRYPTION_OLD_KEYS=<alt> \\",
            "  npm run rotate:secrets -- --dry-run",
            "",
            "# 2. Wenn der Bericht passt, ohne --dry-run",
            "APP_ENCRYPTION_KEY=<neu> APP_ENCRYPTION_OLD_KEYS=<alt> \\",
            "  npm run rotate:secrets",
            "",
            "# 3. APP_ENCRYPTION_OLD_KEYS entfernen",
          ],
        },
      ],
    },
    {
      id: "deployment",
      heading: "Deployment",
      blocks: [
        {
          kind: "list",
          items: [
            "Die vollständige Anleitung (Systembenutzer, systemd, nginx, TLS, Timer und Wiederherstellung) steht in `deploy/README.md`.",
            "`deploy/wanderbibliothek.service`, `deploy/nginx.conf` und `deploy/env.example`: die Anwendung lauscht auf `127.0.0.1:3000`, nginx macht das TLS, und `/api/requests/` läuft ohne Buffering, damit der SSE-Kanal nicht abreißt.",
            "`deploy/wanderbibliothek-maintenance.timer` (alle 15 Minuten) und `deploy/wanderbibliothek-backup.timer` (täglich).",
            "Alternativ `Dockerfile` und `docker-compose.yml`, mehrstufig und nur mit Produktionsabhängigkeiten; der Image-Build wird in der CI geprüft.",
            "Fehlt etwas Wichtiges in der Konfiguration, startet der Prozess zwar, antwortet aber auf alles mit 500 und dem Grund im Log, statt funktionsfähig zu wirken.",
            "`tsx` ist eine Produktionsabhängigkeit: `admin:create`, `db:backup`, `user:verify` und `smoke` brauchen es, auch im Image mit `npm ci --omit=dev`.",
          ],
        },
      ],
    },
    {
      id: "oberflaeche",
      heading: "Oberfläche und Barrierefreiheit",
      blocks: [
        {
          kind: "list",
          items: [
            "Ein einziges Gerüst (`SiteShell`) für die internen Seiten; die Startseite ist die Ausnahme und überlässt dem Katalog die volle Breite.",
            "Farben kommen aus Tokens (`src/app/styles/tokens.css`): außerhalb dieser Datei gibt es keine Literale, deshalb teilen helles und dunkles Thema dasselbe Markup.",
            "Vier Breakpoints (480, 768, 1120 und 1400/1800 px), Abstandsstaffel von 4 bis 48 px und Bedienelemente mit 40 px, mobil 44 px.",
            "Dialoge mit gefangenem Fokus, Schließen per `Escape` und Fokus-Rückgabe; Sprunglink „Zum Inhalt“, `aria-current` in der Navigation, Filter mit `aria-pressed` und Fehler mit `role=\"alert\"`.",
            "Mindestkontrast AA, Schrift ab 12 px, Touch-Ziele mit 44 px auf dem Handy und `prefers-reduced-motion` wird respektiert.",
            "Die Oberfläche ist dreisprachig und jede Sprache hat ihre eigene URL: Deutsch ist die Vorgabe und bleibt ohne Präfix (`/werk/x`), Spanisch und Englisch erscheinen unter `/es/…` und `/en/…`, jeweils mit eigenem `hreflang` und Canonical, damit Suchmaschinen sie getrennt indexieren. Innerhalb einer URL mit Präfix gilt das Präfix; sonst gilt der Umschalter, der das Cookie `wanderbibliothek-locale` setzt und mit Sitzung die Kontoeinstellung für Hinweise und E-Mails speichert; ohne Vorliebe entscheidet die Sprache des Browsers (`Accept-Language`) und, wenn keine der drei passt, Deutsch.",
          ],
        },
      ],
    },
    {
      id: "weiterlesen",
      heading: "Weiterlesen",
      blocks: [
        {
          kind: "links",
          items: [
            {
              label: "Repository",
              href: REPOSITORY,
              note: "Quellcode, Verlauf und private Meldungen zu Sicherheitslücken.",
            },
            {
              label: "DOCUMENTATION.md",
              href: `${REPOSITORY}/blob/main/DOCUMENTATION.md`,
              note: "Dieselbe Seite auf Englisch, im Repository.",
            },
            {
              label: "CONTRIBUTING.md",
              href: `${REPOSITORY}/blob/main/CONTRIBUTING.md`,
              note: "Umgebung, Qualitätsbefehle, Commit-Konventionen und Migrationsregeln.",
            },
            {
              label: "SECURITY.md",
              href: `${REPOSITORY}/blob/main/SECURITY.md`,
              note: "Wie man eine Schwachstelle meldet und was beim Selbsthosten zu beachten ist.",
            },
            {
              label: "deploy/README.md",
              href: `${REPOSITORY}/blob/main/deploy/README.md`,
              note: "Schrittweises Deployment mit systemd, nginx und TLS.",
            },
            {
              label: "LICENSE",
              href: `${REPOSITORY}/blob/main/LICENSE`,
              note: "MIT-Lizenz.",
            },
            {
              label: "NOTICE",
              href: `${REPOSITORY}/blob/main/NOTICE`,
              note: "Herkunftsnachweise für das Titelbild und die Schrift der Cover.",
            },
          ],
        },
      ],
    },
  ],
};

/** Documento técnico en el idioma activo. */
export function technicalDocument(locale: Locale): TechnicalDocument {
  if (locale === "de") return DE;
  if (locale === "en") return EN;
  return ES;
}
