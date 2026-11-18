/**
 * Documentación técnica de la plataforma (`/techdoc`).
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
import { SCHEMA_VERSION } from "./db/schema";
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
const UPDATED = "2026-11-15";

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
            "  app/                 páginas y manejadores de ruta (App Router)",
            "    api/               80 rutas agrupadas por dominio",
            "    styles/            tokens, tipografía, estructura, tarjetas, diálogos, fichas",
            "    proxy.ts           CSP con nonce y cabeceras de seguridad",
            "  components/          estructura de servidor e islas de cliente",
            "  lib/",
            "    db/                conexión, esquema base (v2), migraciones (v3–v58), seed",
            "    repo/              consultas SQL por dominio; `repo.ts` solo reexporta",
            "    validation.ts      esquemas Zod con mensajes traducidos",
            "    secret-box.ts      cifrado reversible con anillo de claves (TOTP)",
            "    e2e.ts             cifrado de extremo a extremo (ECDH + HKDF + AES-GCM)",
            "    route.ts           envoltorio de rutas: sesión, cuerpo, cuota, errores",
            "tests/                 931 pruebas unitarias y de integración (120 ficheros)",
            "e2e/                   pruebas de navegador con Playwright (9 ficheros + humo en Firefox/WebKit)",
            "deploy/                systemd, nginx, plantilla de entorno y guía",
          ],
        },
        {
          kind: "p",
          text: "La estructura (`site-shell.tsx`, `site-rail.tsx`) es Server Component: la barra lateral, la cabecera, el pie y la navegación móvil llegan ya pintados. De la estructura solo se hidratan las islas interactivas (`account-menu`, `theme-toggle`, `locale-switcher`, `verify-email-banner`); el contenido de la aplicación (`wanderbibliothek-app`) es una isla de cliente independiente.",
        },
        {
          kind: "p",
          text: "No viajan los tres diccionarios: `i18n.ts` solo se importa en el servidor y el layout entrega al proveedor de cliente únicamente los textos del idioma activo (el castellano es el origen y llega vacío). Van indexados por un identificador de 32 bits (`messageId`) en vez de por el texto origen: la clave ocupa como mucho diez dígitos y el texto castellano no viaja.",
        },
        {
          kind: "p",
          text: "`getDb()` intercepta `prepare` para reutilizar sentencias compiladas (caché FIFO de 400 por conexión). Los agregados públicos se sirven con `use cache` y la etiqueta `public-data`, que invalidan las rutas que mutan.",
        },
        {
          kind: "p",
          text: "El renderizado no lee `Date.now()` ni `new Date()`: Next lo trata como valor inestable al prerenderizar. Las marcas de tiempo de avisos, mantenimiento y limitadores las pone SQLite con `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.",
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
            ["`/`", "Portada pública: encabezado a pantalla completa, cuatro cifras y una fila de libros **en el idioma de la interfaz** (`BOOK_LANGUAGE_BY_LOCALE`); la portada no enseña el filtro, que sí está en `/descubrir`, y si no hay libros en ese idioma enseña el catálogo entero."],
            ["`/descubrir`", "Catálogo con búsqueda, categorías, orden y paginación en la URL. Se ve sin sesión, pero cada ejemplar muestra solo el libro y la ciudad, nunca quién lo publica; pedir un libro exige cuenta."],
            ["`/werk/[id]`", "Ficha pública de la obra con JSON-LD `Book`/`Offer`: la URL que se indexa."],
            ["`/ofrecer`", "Publicar un ejemplar: el ISBN rellena la ficha bibliográfica."],
            ["`/buscar`", "Buscador global: obras, clubes, lectores y listas."],
            ["`/estanteria`, `/intercambios`", "Secciones privadas: ejemplares propios y solicitudes con su siguiente paso."],
            ["`/comunidad`", "Espacio con pestañas (conversaciones, actividad, clubes, lectores, listas) y ámbito en `?scope=`."],
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
            ["`/techdoc`", "Esta página."],
            ["`/projekt`", "Qué es el proyecto, por qué existe, que no tiene ánimo de lucro y qué demuestra."],
            ["`/normas`", "Gobernanza, moderación, sanciones y apelaciones."],
            ["`/apelar`", "Formulario de apelación desde el enlace del correo de sanción."],
            ["`/api/health`", "Estado del servicio y de la base de datos."],
            ["`/sitemap.xml`, `/robots.txt`", "Indexación: el sitemap publica la portada, las fichas de obra, las listas públicas y las páginas informativas **en los tres idiomas** (con `xhtml:link`), e IndexNow avisa a Bing, y con él a DuckDuckGo y Ecosia, cuando se publica un libro."],
          ],
        },
        {
          kind: "p",
          text: "La API tiene 80 ficheros de ruta en `src/app/api`. `route()` (`src/lib/route.ts`) aplica en un solo sitio la sesión, el esquema Zod del cuerpo, la cuota con guardia de origen y `handleApiError()`, pero hoy solo cubre 21 de los 109 métodos exportados (14 de los 80 ficheros de ruta): el resto repite ese ceremonial a mano y está pendiente de migrar. `tests/route.test.ts` comprueba sobre los ficheros que ninguna ruta se quede sin traducir errores a JSON y que toda mutación comprueba el origen, no que ya use el envoltorio.",
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
            "`/api/account/appeals`, `/api/account/appeal-link`, `/api/admin/appeals/[id]`: apelaciones con token de un solo uso; el enlace se puede pedir de nuevo con el correo de la cuenta y la revisión la hace otra persona, del equipo o, con su nombre registrado, de otra instancia.",
            "`/api/admin/*`, `/api/reports`, `/api/comments/[id]`, `/api/notifications`: denuncias, moderación, comentarios y avisos.",
            "`/api/cover/*`, `/api/isbn/[isbn]`: portadas y ficha bibliográfica (DNB y Open Library). La portada se envía desde disco en cuanto se lee —sin copiarla a memoria— y un 304 que no abre la imagen; el navegador pide además la versión reducida y en WebP a `/_next/image`, así que una tarjeta de 220 px no descarga el JPG de 1600 px. La URL lleva una versión (`?v=…`): al sustituir la portada cambia, y ninguna caché enseña la anterior. El vhost de nginx cachea además esas imágenes en el borde (`proxy_cache`), así que Node no envía bytes de portada en las visitas repetidas.",
            "`/api/cities?q=`: sugerencias de municipio para el selector de ciudad (OpenStreetMap por Photon), sin sesión porque la ciudad se elige ya en el registro.",
            "`/api/cron/maintenance`: tareas programadas, con `MAINTENANCE_TOKEN`: reintenta los envíos pendientes y purga lo viejo.",
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
            "Búsqueda con FTS5 mantenida por disparadores: `listings_fts` para el catálogo y `books_fts` para las obras; `unaccent()` pliega las tildes para que «Lucía» se encuentre escribiendo «lucia».",
            "`cities` guarda las ciudades conocidas con sus coordenadas (la semilla alemana) y `city_distances` su matriz de distancias. La ciudad se elige de una lista de municipios alemanes que da OpenStreetMap (`searchCities()`, por Photon, que sí admite proponer mientras se escribe; si no responde se ofrecen los del catálogo local) y al guardar se comprueba con `resolveCity()`, que pregunta a Nominatim, limitado a Alemania, y guarda el nombre con el que lo conoce el mapa. La distancia es un dato secundario: una ciudad fuera de la lista no muestra kilómetros.",
          ],
        },
        {
          kind: "p",
          text: `Las migraciones se versionan con \`PRAGMA user_version\` (actual: v${SCHEMA_VERSION}). Una instalación nueva nace con \`SCHEMA_V2\` y sus índices y recorre los ${SCHEMA_VERSION - 2} escalones hasta la v${SCHEMA_VERSION}; las existentes suben por la escalera de \`src/lib/db/migrations.ts\`, que conserva los datos. Del historial importan ocho pasos para entender el código de hoy: la v40 (una ranura de clave por dispositivo y un sobre cifrado por clave), la v44 (al cerrar un intercambio, quien lo recibe estrena su propia copia), la v52 (moderación separada de administración, suspensiones con motivo y plazo, y apelaciones), la v53 (quién revisó una apelación y si vino de fuera del equipo), la v54 (instantáneas firmadas del catálogo público), la v56 (el viaje del ejemplar: las copias heredan la procedencia y la ficha puede contarla), la v57 (la obra pasa a ser entidad: \`works\` guarda un id estable, su clave y su propia ficha, y \`books.work_id\` apunta a ella, así que agrupar ediciones ya no es reescribir una cadena derivada) y la v58 (lo diferido deja de tener una tabla por cosa: \`jobs\` guarda estado, intentos, próximo intento y último error para cualquier trabajo, y el correo es un tipo más). El detalle de cada paso está en ese fichero y en su historial de git.`,
        },
        {
          kind: "p",
          text: "Las columnas antiguas de la entrega y del envío (`handover_*`, `ship_*`) siguen en la base para no borrar lo que se guardó en su momento, pero ya no las escribe ni las lee nadie: la entrega se acuerda en la conversación y cada parte confirma en la plataforma cuando tiene el libro.",
        },
        {
          kind: "p",
          text: "Un intercambio no deja el libro huérfano: al cerrarse, el ejemplar entregado queda `given` (es el histórico) y quien lo recibe estrena **su propia copia**, con la misma edición y la misma condición, en su ciudad y en pausa (`listings.from_listing_id` y `from_request_id` guardan el rastro). Desde su estantería puede activarla y el libro vuelve a circular; si el ejemplar original lo había retirado la moderación, la copia nace igualmente y nada vuelve al catálogo sin que su dueño lo decida.",
        },
        {
          kind: "p",
          text: "Los mensajes van cifrados de extremo a extremo (ver **Seguridad**): la base guarda el sobre y la huella de la clave, y el API rechaza el texto plano (422).",
        },
        {
          kind: "list",
          items: [
            "Un ejemplar solo se reserva si sigue `available`, dentro de la misma transacción.",
            "Al aceptar, las solicitudes rivales pasan a `expired`; solo el dueño acepta o rechaza.",
            "El cierre es bilateral: cada parte confirma por separado y solo la segunda confirmación completa el intercambio.",
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
            "Los mensajes de intercambio y directos van cifrados de extremo a extremo (ECDH P-256 + HKDF-SHA256 + AES-GCM). Cada cuenta publica **una clave por ranura** (`web` y `android`); el remitente guarda un sobre por cada clave del destinatario, así que el navegador y la app leen el mismo mensaje. Solo la primera clave de una cuenta se publica sin confirmación: en cuanto hay una ranura ocupada, tanto sustituirla como **añadir un dispositivo** exigen la contraseña, y cada cambio genera un aviso de seguridad. En el navegador la identidad es **una por cuenta**: dos cuentas en el mismo equipo nunca comparten par de claves.",
            "Sesión de 256 bits en cookie `httpOnly` con `SameSite=Lax`; en producción solo se acepta el prefijo `__Host-` y en la base solo vive su SHA-256.",
            "Verificación en dos pasos (TOTP RFC 6238, ventana de ±1 paso y anti-replay) obligatoria para moderar y administrar en producción; los secretos se guardan cifrados. Las sanciones llevan motivo y plazo (1–365 días), y la apelación la revisa otra persona del equipo.",
            "Cuotas atómicas en base de datos por IP y por cuenta, con `429` y `Retry-After`.",
            "Todas las mutaciones pasan por `guard()` (origen y cuota) y `readJson()` exige `application/json` y corta los cuerpos de más de 64 KB.",
            "CSP con nonce y `strict-dynamic`, `X-Frame-Options: DENY`, COOP/CORP, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y HSTS en producción (`src/proxy.ts`).",
            "Directorio `0700` y base `0600`; `npm run db:backup` usa la API `.backup()` de SQLite y cifra con AES-256-GCM si existe `WANDERBIBLIOTHEK_BACKUP_KEY`.",
            "Registro con honeypot, tiempo mínimo y Cloudflare Turnstile opcional; mensaje genérico para no revelar correos registrados.",
            "Tokens de cuenta de un solo uso, hasheados y con caducidad; cambiar la contraseña revoca todas las sesiones.",
            "`GET /api/account/export` entrega todos los datos en JSON, **incluidos los sobres** de cada mensaje (sin ellos no se podría descifrar nada fuera de la aplicación), y borrar la cuenta anonimiza el perfil, retira sus ejemplares, borra sus claves de dispositivo, sus conversaciones directas, sus reseñas, sus mensajes de foro y sus votos, likes y asistencias, y conserva el historial de intercambio sin romper los hilos ajenos.",
            "Un mensaje cifrado se rechaza si falta el sobre de algún dispositivo activo del destinatario: el que se quedara fuera no podría leerlo y el fallo aparecería días después.",
            "Lo que este cifrado **no** cubre, dicho sin adornos: cada mensaje se cifra con la clave de identidad de su ranura, **sin secreto hacia delante** (no hay ratchet), y no hay recuperación. Quien obtenga a la vez la base y la clave privada de un dispositivo puede leer lo que ese dispositivo recibió; perder el dispositivo o los datos del navegador es perder ese historial. Cambiarlo exige versionar el protocolo y los dos clientes, no un parche.",
          ],
        },
      ],
    },
    {
      id: "transparencia",
      heading: "Transparencia",
      blocks: [
        {
          kind: "p",
          text: "`GET /api/version` publica el commit, el digest de la imagen y la hora del build con los que se construyó esta instancia, además de los enlaces al repositorio. Si el despliegue no los conoce, los campos valen `null`: no se inventa un commit. El pie de página enseña el mismo identificador cuando existe.",
        },
        {
          kind: "p",
          text: "Cada etiqueta `v*` se publica como imagen en GHCR fijada por digest, con provenance SLSA y SBOM, y firmada con cosign en modo keyless. `deploy/verify-release.sh` comprueba que la firma corresponde a este repositorio y a su workflow de release; desplegar por digest impide que una etiqueta móvil cambie la imagen verificada.",
        },
        {
          kind: "p",
          text: "El cron crea como mucho una instantánea al día del catálogo público: una línea JSON canónica por obra, su SHA-256, una raíz de Merkle y una firma Ed25519 si la instancia tiene `TRANSPARENCY_SIGNING_KEY`. `/api/transparency` lista las instantáneas y `/api/transparency/export` entrega el NDJSON exacto que se firmó. `npm run transparency:verify -- --url …` recalcula todo desde fuera, comprueba la cadena de raíces y permite fijar la huella de la clave pública (`--key-fingerprint`) además de la raíz (`--pin`).",
        },
        {
          kind: "list",
          items: [
            "Lo que garantiza: que un cambio en el contenido publicado deja rastro y que una instantánea pasada no se puede sustituir por otra sin romper la firma o la cadena.",
            "Lo que no incluye: nada de personas. El contenido sale de `listPublicWorks()` —obra, ediciones, ejemplares por ciudad—, nunca de quién tiene cada ejemplar, y por eso se puede servir sin sesión.",
            "Lo que no puede garantizar: sin attestation por hardware (TPM 2.0 con IMA y un verificador como Keylime, o una máquina confidencial con SEV-SNP/TDX) nada demuestra criptográficamente que el proceso que responde sea la imagen firmada. La manipulación es detectable, no imposible, y así se dice en la guía de despliegue.",
          ],
        },
      ],
    },
    {
      id: "permisos",
      heading: "Permisos por recurso",
      blocks: [
        {
          kind: "p",
          text: "La autenticación no basta: cada operación comprueba además que el recurso sea de quien la pide, y lo hace **dentro de la consulta** (`owner_id = ?` o «alguna de las dos partes»), no en un `if` del componente. Por eso un identificador ajeno responde `404` («no existe») y no `403`: un 403 confirmaría que existe algo con ese id.",
        },
        {
          kind: "table",
          head: ["Operación", "Sin sesión", "Otra cuenta", "Parte o dueño", "Administración"],
          rows: [
            ["Ver el catálogo y la ficha de una obra", "Sí", "Sí", "Sí", "Sí"],
            ["Publicar un ejemplar", "No", "Sí, con correo confirmado", "Sí", "Sí"],
            ["Editar, pausar o retirar un ejemplar", "No", "No", "Solo su dueño", "Retira, no edita"],
            ["Ver una solicitud de intercambio", "No", "No", "Solo sus dos partes", "No"],
            ["Aceptar, cancelar o confirmar un intercambio", "No", "No", "Sus dos partes, según el papel y la transición", "No"],
            ["Leer o escribir en un hilo directo", "No", "No", "Sus participantes, con seguimiento mutuo y clave publicada", "No"],
            ["Valorar a la otra persona", "No", "No", "Una vez, con el intercambio completado", "No"],
            ["Comentar, escribir en un club o en una lista", "No", "Sí, con correo confirmado", "Sí", "Sí"],
            ["Moderar: denuncias, suspensiones, borrados", "No", "No", "No", "Sí, con 2FA en producción"],
            ["Exportar o borrar la cuenta", "No", "No", "Solo su titular", "No"],
          ],
        },
        {
          kind: "p",
          text: "`tests/authorization.test.ts` recorre esta tabla con un dueño, una tercera cuenta y un seguimiento unilateral; las pruebas de clubes, privacidad e intercambios cubren el resto de papeles.",
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
            ["`NEXT_PUBLIC_SITE_URL`", "`http://localhost:3000`", "Base de los canonical, `sitemap.xml` y `robots.txt`. Obligatoria en producción y siempre `https://`."],
            ["`APP_ENCRYPTION_KEY`", "sin definir", "32 bytes en hex o base64 para el secreto TOTP. Obligatoria; `APP_ENCRYPTION_KEY_ID` y `APP_ENCRYPTION_OLD_KEYS` solo hacen falta al rotarla."],
            ["`WANDERBIBLIOTHEK_DB`", "`.data/wanderbibliothek.db`", "Ruta de la base SQLite (`:memory:` en las pruebas)."],
            ["`BREVO_API_KEY` / `MAIL_FROM`", "sin definir", "Correo directo por la API de Brevo. `MAIL_FROM` admite `Nombre <correo@dominio>`."],
            ["`MAIL_WEBHOOK_URL` / `MAIL_WEBHOOK_TOKEN`", "sin definir", "Alternativa a Brevo: recibe `{to, subject, text}`; si están las dos, manda el webhook."],
            ["`MAINTENANCE_TOKEN`", "sin definir", "Token del cron `POST /api/cron/maintenance`; sin él, 404."],
            ["`TRUST_PROXY`", "sin definir", "`1` solo con un proxy propio delante: autoriza `X-Forwarded-For`/`-Host` y activa las cuotas por IP."],
            ["`WANDERBIBLIOTHEK_BACKUP_KEY` / `WANDERBIBLIOTHEK_BACKUP_KEEP`", "sin definir / `14`", "Clave de las copias cifradas y cuántas se conservan al rotar."],
            ["`ERROR_WEBHOOK_URL` / `ERROR_WEBHOOK_TOKEN`", "sin definir", "Reciben los errores 500 en JSON, ya redactados."],
            ["`NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET`", "sin definir", "Activan Cloudflare Turnstile en el registro."],
            ["`REQUIRE_EMAIL_VERIFICATION`", "sin definir", "`1` exige el correo confirmado para publicar, solicitar, comentar y escribir."],
            ["`AUDIT_RETENTION_DAYS`", "`730`", "Días que se conserva `admin_audit` (0 = para siempre)."],
            ["`LEGAL_*`", "sin definir", "Titular, dirección, contacto y datos opcionales de `/privacidad` y `/aviso-legal`."],
            ["`MASTODON_*`", "apagado", "Integración opcional con Mastodon; sin `MASTODON_TOKEN` está apagada."],
            ["`TRANSPARENCY_SIGNING_KEY`", "sin definir", "Clave Ed25519 (PKCS#8 en base64 o PEM) que firma la instantánea diaria del catálogo. Sin ella se publican sin firma y así se indica."],
            ["`APP_COMMIT_SHA` / `APP_BUILD_TIME` / `APP_IMAGE`", "sin definir", "Identidad del build que publica `/api/version`; la rellena el workflow de release o `deploy/deploy.sh`."],
          ],
        },
        {
          kind: "p",
          text: "La plantilla canónica es `deploy/env.example`: ahí están todas, las de este cuadro y las de detalle (bot, copias, datos de demostración, cuota de Google Books, primer administrador), comentadas con su valor por defecto.",
        },
      ],
    },
    {
      id: "pruebas",
      heading: "Pruebas e integración continua",
      blocks: [
        {
          kind: "p",
          text: "`npm test` ejecuta 931 pruebas unitarias y de integración en 120 ficheros (runner de Node sobre SQLite en memoria) y `npm run test:e2e` añade 64 pruebas de navegador con Chromium, que arranca su propio servidor en el puerto 3100; `npm run test:e2e:smoke` ejecuta el humo de WebCrypto e IndexedDB en Firefox y WebKit.",
        },
        {
          kind: "p",
          text: "`npm run test:coverage` aplica umbrales mínimos del 92 % de líneas, 80 % de ramas y 88 % de funciones. Dos pruebas de navegador son vallas y no funcionalidad: `e2e/accesibilidad.spec.ts` pasa **axe** (WCAG 2.0/2.1 A y AA) por la portada, el catálogo, una ficha y la ventana de acceso, y falla con lo que axe marca como `serious` o `critical`; `e2e/rendimiento.spec.ts` comprueba que una visita al catálogo cabe en un **presupuesto de bytes** y que ninguna imagen pasa de 250 KB, que es lo que impide volver a las portadas de 1,3 MB. El presupuesto se mide sobre el build de producción, así que solo corre en la CI. La integración continua (`.github/workflows/ci.yml`) ejecuta `lint`, `typecheck`, `test`, `test:coverage`, `build`, `npm audit --omit=dev`, las pruebas de navegador y un build de la imagen Docker, que además se escanea con Trivy: el trabajo se corta solo con vulnerabilidades **críticas y con parche**, porque un aviso sin corrección disponible no se puede arreglar en ese momento pero queda en el registro.",
        },
        {
          kind: "p",
          text: "Cada ejecución publica un **SBOM** en CycloneDX (`npm sbom`) con las dependencias de producción: ante un aviso, dice si esa versión llegó a desplegarse. `tests/no-secrets.test.ts` escanea el árbol de trabajo buscando credenciales (claves de Brevo, tokens de GitHub, claves privadas, claves de 32 bytes asignadas a una variable con nombre de clave): corre en local y en el CI sin depender de ningún servicio, y no sustituye a revisar el historial de git. El análisis estático (CodeQL con las consultas `security-extended`) va aparte en `.github/workflows/codeql.yml`, también programado los lunes para recoger consultas nuevas.",
        },
        {
          kind: "p",
          text: "El CI audita también las dependencias de **desarrollo** (`npm audit` completo): ESLint, TypeScript y Playwright construyen lo que se publica. Y el `override` de `minimatch@11` en `package.json` está porque `@typescript-eslint/typescript-estree` resolvía una versión con un aviso de ReDoS; solo afecta a la cadena de ESLint, no al runtime, y se puede retirar cuando esa dependencia lo traiga por sí sola.",
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
            "`npm run db:verify` es el ensayo de restauración: descifra la copia más reciente (o la que se le pase), la abre en solo lectura como lo haría la aplicación, ejecuta `integrity_check` y `foreign_key_check`, comprueba la versión del esquema y cuenta las tablas principales. Sale con error si la copia no se puede restaurar.",
            "`POST /api/cron/maintenance` con `Authorization: Bearer $MAINTENANCE_TOKEN` caduca solicitudes, purga sesiones, avisos y cuotas, borra la actividad vieja (`events` y `product_events`, 180 días), las denuncias resueltas (1 año), las apelaciones resueltas (2 años) y la auditoría de moderación según `AUDIT_RETENTION_DAYS`, y envía los recordatorios de los clubes.",
            "`npm run user:verify -- <correo>` y `npm run admin:2fa-off -- <correo>` son las salidas de emergencia cuando el correo o el segundo factor dejan a alguien fuera.",
            "Las rutas envueltas por `route()` dejan una línea `[req] {…}` y la cabecera `x-response-time`; nginx registra **todas las peticiones a la aplicación** con el mismo `x-request-id`, que también vuelve al cliente. Las rutas escritas a mano aún no emiten esa línea: la migración pendiente las va cubriendo. En `/api/metrics` (administración o el token del mantenimiento) hay un resumen de latencia p50/p95/p99 de esas rutas, memoria, flujos en vivo, el estado de las colas de trabajo y el tamaño de la base y del WAL; con `?format=prometheus` sale en el formato que entiende un recolector. El `reference` que devuelve un 500 son los 8 primeros caracteres de ese id.",
            "Una consulta que pasa de 50 ms deja un aviso `[db] consulta lenta` con su duración y la SQL recortada: `better-sqlite3` es síncrono y, mientras una consulta corre, el proceso entero está parado. El cron devuelve además en `db` el tamaño del fichero, el del WAL y las páginas libres **después** del checkpoint.",
            "Una sola instancia: SQLite tiene un único escritor, así que escalar en horizontal exige PostgreSQL. El canal en vivo **no** lo exige: el bus en memoria solo ahorra latencia y la fuente de verdad es una marca que se consulta en la base, de modo que un segundo proceso sigue funcionando (con hasta 15 s de retraso entre instancias). Un bus compartido quitaría ese retraso, no habilitaría el despliegue.",
            "Techo medido con `npm run bench:sqlite`: unas 100 000 escrituras/s sueltas, más de 200 000/s en lote, unas 300 000 lecturas/s por clave primaria y 2 000/s en un filtro sin índice sobre 5 000 filas. El límite real es la duración de cada transacción, no el número de visitas.",
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
            "`deploy/wanderbibliothek-maintenance.timer` (cada 15 minutos) y `deploy/wanderbibliothek-backup.timer` (cada 6 horas).",
            "También hay `Dockerfile` y `docker-compose.yml` multi-etapa con solo dependencias de producción; el build de la imagen se valida en la integración continua.",
            "Si falta una variable obligatoria en la configuración, el proceso arranca pero responde 500 a todo con el motivo en el log, en lugar de parecer que funciona.",
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
            "Lo que no se ve al cargar no viaja en el paquete inicial: el diálogo de acceso, el de intercambio (criptografía y QR), el formulario de publicación, las notificaciones y las vistas de comunidad e intercambios se descargan con `next/dynamic` cuando se abren. La criptografía del navegador se importa al publicar la clave, no al arrancar. Ojo con `dynamic` en algo que se monta siempre: sin `loading`, su descarga suspende el árbol entero y la página tarda en responder (lo cubre `e2e/app.spec.ts` con el foco del corazón).",
            "Contraste mínimo AA, tipografía desde 12 px, objetivos táctiles de 44 px en móvil y `prefers-reduced-motion` respetado: las animaciones (en `styles/motion.css`) solo mueven `opacity` y `transform`, y se apagan enteras con esa preferencia.",
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
              note: "Atribuciones de la fotografía de portada y de los componentes de terceros.",
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
            "  app/                 Seiten und Route-Handler (App Router)",
            "    api/               80 Routen, nach Domäne gruppiert",
            "    styles/            Tokens, Typografie, Struktur, Karten, Dialoge, Detailseiten",
            "    proxy.ts           CSP mit Nonce und Sicherheits-Header",
            "  components/          Server-Struktur und interaktive Inseln",
            "  lib/",
            "    db/                Verbindung, Basisschema (v2), Migrationen (v3–v58), Seed",
            "    repo/              SQL-Abfragen je Domäne; `repo.ts` reexportiert nur",
            "    validation.ts      Zod-Schemata mit übersetzten Meldungen",
            "    secret-box.ts      umkehrbare Verschlüsselung mit Schlüsselring (TOTP)",
            "    e2e.ts             Ende-zu-Ende-Verschlüsselung (ECDH + HKDF + AES-GCM)",
            "    route.ts           Routen-Wrapper: Sitzung, Body, Kontingent, Fehler",
            "tests/                 931 Unit- und Integrationstests (120 Dateien)",
            "e2e/                   Browser-Tests mit Playwright (9 Dateien + Smoke in Firefox/WebKit)",
            "deploy/                systemd, nginx, Umgebungsvorlage und Anleitung",
          ],
        },
        {
          kind: "p",
          text: "Die Struktur (`site-shell.tsx`, `site-rail.tsx`) ist ein Server Component: Seitenleiste, Kopfzeile, Fußzeile und mobile Navigation kommen fertig gerendert an. Von der Struktur werden nur die interaktiven Inseln hydratisiert (`account-menu`, `theme-toggle`, `locale-switcher`, `verify-email-banner`); der Inhalt der Anwendung (`wanderbibliothek-app`) ist eine eigene Client-Insel.",
        },
        {
          kind: "p",
          text: "Es reisen nicht alle drei Wörterbücher: `i18n.ts` wird nur auf dem Server importiert, und das Layout gibt dem Client-Provider nur die Texte der aktiven Sprache (Spanisch ist die Ausgangssprache und wird nicht mitgeschickt). Sie sind über eine 32-Bit-Kennung (`messageId`) adressiert statt über den Quelltext: der Schlüssel ist höchstens zehn Ziffern lang und der spanische Text reist nicht mit.",
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
            ["`/`", "Öffentliche Startseite: Kopfteil über die volle Breite, vier Kennzahlen und eine Reihe Bücher **in der Sprache der Oberfläche** (`BOOK_LANGUAGE_BY_LOCALE`); die Startseite zeigt den Filter nicht (der steht in `/descubrir`), und ohne Bücher in dieser Sprache zeigt sie den ganzen Katalog."],
            ["`/descubrir`", "Vollständiger Katalog mit Suche, Kategorien, Sortierung und Seitenzahl in der URL. Ohne Sitzung sichtbar; zum Anfragen braucht es eine."],
            ["`/werk/[id]`", "Öffentliche Werkseite mit JSON-LD `Book`/`Offer`: die URL, die indexiert wird."],
            ["`/ofrecer`", "Ein Exemplar einstellen: die ISBN füllt die bibliografischen Daten."],
            ["`/buscar`", "Globale Suche: Werke, Clubs, Leser:innen und Listen."],
            ["`/estanteria`, `/intercambios`", "Private Bereiche: eigene Exemplare und Anfragen mit dem nächsten Schritt."],
            ["`/comunidad`", "Bereich mit Tabs (Gespräche, Aktivität, Clubs, Leser:innen, Listen) und Umfang über `?scope=`."],
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
            ["`/techdoc`", "Diese Seite."],
            ["`/projekt`", "Was das Projekt ist, warum es existiert, dass es keinen kommerziellen Zweck hat und was es zeigt."],
            ["`/normas`", "Governance, Moderation, Sanktionen und Einsprüche."],
            ["`/apelar`", "Einspruchsformular über den Link in der Sanktions-E-Mail."],
            ["`/api/health`", "Zustand von Dienst und Datenbank."],
            ["`/sitemap.xml`, `/robots.txt`", "Indexierung: die Sitemap veröffentlicht Startseite, Werkseiten, öffentliche Listen und Infoseiten **in allen drei Sprachen** (mit `xhtml:link`); IndexNow benachrichtigt Bing, und damit DuckDuckGo und Ecosia, sobald ein Buch eingestellt wird."],
          ],
        },
        {
          kind: "p",
          text: "Die API besteht aus 80 Route-Dateien unter `src/app/api`. `route()` (`src/lib/route.ts`) wendet an einer Stelle Sitzung, Zod-Schema des Bodys, Kontingent mit Herkunftsprüfung und `handleApiError()` an, deckt aber heute nur 21 der 109 exportierten Methoden ab (14 der 80 Route-Dateien): der Rest wiederholt das von Hand und wartet auf die Migration. `tests/route.test.ts` prüft anhand der Dateien, dass keine Route Fehler unübersetzt durchlässt und dass jede Mutation die Herkunft prüft — nicht, dass sie den Wrapper schon nutzt.",
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
            "`/api/account/appeals`, `/api/account/appeal-link`, `/api/admin/appeals/[id]`: Einsprüche mit Einmal-Token; der Link lässt sich mit der E-Mail des Kontos neu anfordern, und geprüft wird von einer anderen Person, aus dem Team oder, mit Namen protokolliert, aus einer anderen Instanz.",
            "`/api/admin/*`, `/api/reports`, `/api/comments/[id]`, `/api/notifications`: Meldungen, Moderation, Kommentare und Hinweise.",
            "`/api/cover/*`, `/api/isbn/[isbn]`: Cover und bibliografische Daten (DNB und Open Library). Das Cover wird beim Lesen von der Platte gestreamt —ohne es in den Speicher zu kopieren—, und ein 304 öffnet das Bild nicht; der Browser holt zusätzlich die verkleinerte WebP-Fassung über `/_next/image`, sodass eine 220-Pixel-Karte nicht das 1600-Pixel-JPG lädt. Die URL trägt eine Version (`?v=…`): wird das Cover ersetzt, ändert sie sich und kein Cache zeigt das alte. Der nginx-Vhost legt diese Bilder zusätzlich am Rand ab (`proxy_cache`), sodass Node bei wiederholten Besuchen keine Cover-Bytes mehr sendet.",
            "`/api/cities?q=`: Ortsvorschläge für die Stadtauswahl (OpenStreetMap über Photon), ohne Sitzung, weil die Stadt schon bei der Registrierung gewählt wird.",
            "`/api/cron/maintenance`: geplante Aufgaben mit `MAINTENANCE_TOKEN`: wiederholt ausstehende Zustellungen und räumt Altes auf.",
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
            "Suche über FTS5, von Triggern gepflegt: `listings_fts` für den Katalog und `books_fts` für die Werke; `unaccent()` faltet Akzente, damit „Lucía“ auch als „lucia“ gefunden wird.",
            "`cities` hält die bekannten Städte mit ihren Koordinaten (der deutsche Grundstock), `city_distances` deren Distanzmatrix. Die Stadt wird aus einer Liste deutscher Gemeinden gewählt, die OpenStreetMap liefert (`searchCities()`, über Photon, das Vorschläge beim Tippen erlaubt; antwortet es nicht, werden die des lokalen Grundstocks angeboten) und beim Speichern mit `resolveCity()` geprüft, das Nominatim fragt, begrenzt auf Deutschland, und den Namen speichert, den die Karte kennt. Die Entfernung ist Nebensache: eine Stadt außerhalb der Liste zeigt keine Kilometer.",
          ],
        },
        {
          kind: "p",
          text: `Migrationen werden über \`PRAGMA user_version\` versioniert (aktuell: v${SCHEMA_VERSION}). Eine neue Installation startet mit \`SCHEMA_V2\` und seinen Indizes und steigt die ${SCHEMA_VERSION - 2} Stufen bis v${SCHEMA_VERSION} hinauf; bestehende steigen über die Leiter in \`src/lib/db/migrations.ts\` auf, die die Daten erhält. Für den heutigen Code zählen acht Schritte: die v40 (ein Schlüssel-Slot je Gerät und ein verschlüsselter Umschlag pro Schlüssel), die v44 (beim Abschluss eines Tauschs bekommt die empfangende Seite ein eigenes Exemplar), die v52 (Moderation getrennt von Verwaltung, Sperren mit Grund und Frist, Einsprüche), die v53 (wer einen Einspruch geprüft hat und ob die Person von außerhalb des Teams kam), die v54 (signierte Momentaufnahmen des öffentlichen Katalogs), die v56 (die Reise des Exemplars: Kopien erben die Herkunft und die Seite kann sie erzählen), die v57 (das Werk wird eine Entität: \`works\` hält eine stabile Id, seinen Schlüssel und einen eigenen Eintrag, und \`books.work_id\` zeigt darauf; Ausgaben zu gruppieren heißt damit nicht mehr, eine abgeleitete Zeichenkette umzuschreiben) und die v58 (Aufgeschobenes hat nicht mehr eine Tabelle pro Sache: \`jobs\` hält Status, Versuche, nächsten Versuch und letzten Fehler für jede Aufgabe, und E-Mail ist eine Art davon). Die Einzelheiten stehen in dieser Datei und in ihrer Git-Historie.`,
        },
        {
          kind: "p",
          text: "Die alten Spalten für Übergabe und Versand (`handover_*`, `ship_*`) bleiben in der Datenbank, damit nichts Gespeichertes verloren geht, aber kein Code schreibt oder liest sie mehr: die Übergabe wird im Gespräch vereinbart und jede Seite bestätigt in der Plattform, wenn sie das Buch hat.",
        },
        {
          kind: "p",
          text: "Ein Tausch lässt das Buch nicht verwaisen: beim Abschluss bleibt das übergebene Exemplar `given` (das ist der Verlauf) und wer es bekommt, bekommt **ein eigenes Exemplar** – dieselbe Ausgabe, derselbe Zustand, in derselben Stadt und pausiert (`listings.from_listing_id` und `from_request_id` halten die Spur). Aus dem eigenen Regal lässt es sich aktivieren, und das Buch wandert weiter; hatte die Moderation das ursprüngliche Exemplar entfernt, entsteht die Kopie trotzdem und nichts kehrt ohne die Entscheidung der Person in den Katalog zurück.",
        },
        {
          kind: "p",
          text: "Nachrichten sind Ende-zu-Ende verschlüsselt (siehe **Sicherheit**): die Datenbank speichert den Umschlag und den Schlüssel-Fingerabdruck, und die API lehnt Klartext ab (422).",
        },
        {
          kind: "list",
          items: [
            "Ein Exemplar wird nur reserviert, wenn es noch `available` ist – innerhalb derselben Transaktion.",
            "Beim Annehmen wandern konkurrierende Anfragen nach `expired`; annehmen oder ablehnen kann nur die Eigentümer:in.",
            "Der Abschluss ist beidseitig: jede Seite bestätigt getrennt, und erst die zweite Bestätigung schließt den Tausch.",
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
            "Tausch- und Direktnachrichten sind Ende-zu-Ende verschlüsselt (ECDH P-256 + HKDF-SHA256 + AES-GCM). Jedes Konto veröffentlicht **einen Schlüssel pro Geräte-Slot** (`web` und `android`); der Absender speichert pro Empfängerschlüssel einen Umschlag, sodass Browser und App dieselbe Nachricht lesen. Nur der erste Schlüssel eines Kontos wird ohne Bestätigung veröffentlicht: Sobald ein Slot belegt ist, verlangt sowohl das Ersetzen als auch das **Hinzufügen eines Geräts** das Kontopasswort, und jede Änderung erzeugt einen Sicherheitshinweis. Im Browser gibt es **eine Identität pro Konto**: zwei Konten auf demselben Gerät teilen nie ein Schlüsselpaar.",
            "Sitzung mit 256 Bit im `httpOnly`-Cookie und `SameSite=Lax`; in Produktion wird nur das Präfix `__Host-` akzeptiert, und in der Datenbank liegt nur ihr SHA-256.",
            "Zweiter Faktor (TOTP nach RFC 6238, Fenster ±1 Schritt, Anti-Replay) ist für Moderation und Verwaltung in Produktion Pflicht; die Geheimnisse liegen verschlüsselt. Sanktionen haben Grund und Frist (1–365 Tage), und über den Einspruch entscheidet eine andere Person im Team.",
            "Atomare Kontingente in der Datenbank je IP und je Konto, mit `429` und `Retry-After`.",
            "Alle schreibenden Zugriffe laufen über `guard()` (Herkunft und Kontingent), und `readJson()` verlangt `application/json` und kappt Bodys über 64 KB.",
            "CSP mit Nonce und `strict-dynamic`, `X-Frame-Options: DENY`, COOP/CORP, `nosniff`, `Referrer-Policy`, `Permissions-Policy` und HSTS in Produktion (`src/proxy.ts`).",
            "Verzeichnis `0700` und Datenbank `0600`; `npm run db:backup` nutzt die `.backup()`-API von SQLite und verschlüsselt mit AES-256-GCM, wenn `WANDERBIBLIOTHEK_BACKUP_KEY` gesetzt ist.",
            "Registrierung mit Honeypot, Mindestzeit und optionalem Cloudflare Turnstile; die Antwort ist allgemein gehalten, um keine Adressen zu verraten.",
            "Konto-Tokens sind einmalig, gehasht und befristet; ein Passwortwechsel beendet alle Sitzungen.",
            "`GET /api/account/export` liefert alle Daten als JSON, **einschließlich der Umschläge** jeder Nachricht (ohne sie ließe sich außerhalb der Anwendung nichts entschlüsseln); das Löschen des Kontos anonymisiert das Profil, zieht die eigenen Exemplare zurück, löscht die Geräteschlüssel, die Direktgespräche, die Rezensionen, die Forumsbeiträge sowie Stimmen, Likes und Teilnahmen und bewahrt den Tauschverlauf, ohne fremde Gespräche zu zerreißen.",
            "Eine verschlüsselte Nachricht wird abgelehnt, wenn der Umschlag für ein aktives Gerät der anderen Person fehlt: Das übergangene Gerät könnte sie nicht lesen, und der Fehler würde erst Tage später auffallen.",
            "Was diese Verschlüsselung **nicht** abdeckt, ohne Beschönigung: Jede Nachricht wird mit dem Identitätsschlüssel ihrer Slot verschlüsselt, **ohne Forward Secrecy** (kein Ratchet), und es gibt keine Wiederherstellung. Wer gleichzeitig die Datenbank und den privaten Schlüssel eines Geräts erlangt, kann lesen, was dieses Gerät empfangen hat; ein verlorenes Gerät oder gelöschte Browserdaten bedeuten verlorene Historie. Das zu ändern verlangt eine versionierte Änderung des Protokolls und beider Clients, keinen Patch.",
          ],
        },
      ],
    },
    {
      id: "transparenz",
      heading: "Transparenz",
      blocks: [
        {
          kind: "p",
          text: "`GET /api/version` veröffentlicht Commit, Image-Digest und Build-Zeit dieser Instanz sowie die Links zum Repository. Kennt ein Deployment sie nicht, sind die Felder `null`: Es wird kein Commit erfunden. Die Fußzeile zeigt dieselbe Kennung, wenn sie existiert.",
        },
        {
          kind: "p",
          text: "Jedes Tag `v*` wird als Image in GHCR mit festem Digest veröffentlicht, mit SLSA-Provenance und SBOM, signiert mit cosign im Keyless-Modus. `deploy/verify-release.sh` prüft, dass die Signatur zu diesem Repository und seinem Release-Workflow gehört; ein Deployment per Digest verhindert, dass ein bewegliches Tag das geprüfte Image austauscht.",
        },
        {
          kind: "p",
          text: "Der Cron erstellt höchstens eine Momentaufnahme des öffentlichen Katalogs pro Tag: eine kanonische JSON-Zeile pro Werk, ihren SHA-256, eine Merkle-Wurzel und eine Ed25519-Signatur, wenn die Instanz `TRANSPARENCY_SIGNING_KEY` hat. `/api/transparency` listet die Momentaufnahmen, `/api/transparency/export` liefert genau das signierte NDJSON. `npm run transparency:verify -- --url …` berechnet alles von außen neu, prüft die Kette der Wurzeln und erlaubt neben der Wurzel (`--pin`) auch den Fingerabdruck des öffentlichen Schlüssels (`--key-fingerprint`) zu fixieren.",
        },
        {
          kind: "list",
          items: [
            "Was es garantiert: Eine Änderung am veröffentlichten Inhalt hinterlässt eine Spur, und eine frühere Momentaufnahme lässt sich nicht durch eine andere ersetzen, ohne Signatur oder Kette zu brechen.",
            "Was nicht enthalten ist: nichts über Personen. Der Inhalt kommt aus `listPublicWorks()` — Werk, Ausgaben, Exemplare pro Stadt —, nie daraus, wer ein Exemplar besitzt; deshalb ist er ohne Sitzung abrufbar.",
            "Was es nicht garantieren kann: Ohne Hardware-Attestation (TPM 2.0 mit IMA und einem Prüfer wie Keylime oder eine vertrauliche VM mit SEV-SNP/TDX) beweist nichts kryptografisch, dass der antwortende Prozess das signierte Image ist. Manipulation ist erkennbar, nicht unmöglich; die Bereitstellungsanleitung sagt das ausdrücklich.",
          ],
        },
      ],
    },
    {
      id: "berechtigungen",
      heading: "Berechtigungen pro Ressource",
      blocks: [
        {
          kind: "p",
          text: "Anmeldung allein genügt nicht: jede Operation prüft zusätzlich, ob die Ressource der anfragenden Person gehört, und zwar **innerhalb der Abfrage** (`owner_id = ?` oder «eine der beiden Seiten»), nicht in einem `if` der Komponente. Deshalb antwortet eine fremde Kennung mit `404` («existiert nicht») und nicht mit `403`: ein 403 würde bestätigen, dass es etwas mit dieser Kennung gibt.",
        },
        {
          kind: "table",
          head: ["Operation", "Ohne Sitzung", "Anderes Konto", "Seite oder Eigentümer", "Administration"],
          rows: [
            ["Katalog und Werkseite ansehen", "Ja", "Ja", "Ja", "Ja"],
            ["Ein Exemplar einstellen", "Nein", "Ja, mit bestätigter E-Mail", "Ja", "Ja"],
            ["Exemplar bearbeiten, pausieren oder zurückziehen", "Nein", "Nein", "Nur der Eigentümer", "Zieht zurück, bearbeitet nicht"],
            ["Eine Tauschanfrage sehen", "Nein", "Nein", "Nur ihre beiden Seiten", "Nein"],
            ["Tausch annehmen, abbrechen oder bestätigen", "Nein", "Nein", "Die beiden Seiten, je nach Rolle und Übergang", "Nein"],
            ["Einen Direktchat lesen oder schreiben", "Nein", "Nein", "Seine Teilnehmenden, mit gegenseitigem Folgen und veröffentlichtem Schlüssel", "Nein"],
            ["Die andere Person bewerten", "Nein", "Nein", "Einmal, nach abgeschlossenem Tausch", "Nein"],
            ["Kommentieren, im Club oder in einer Liste schreiben", "Nein", "Ja, mit bestätigter E-Mail", "Ja", "Ja"],
            ["Moderieren: Meldungen, Sperren, Löschungen", "Nein", "Nein", "Nein", "Ja, in Produktion mit 2FA"],
            ["Konto exportieren oder löschen", "Nein", "Nein", "Nur die Inhaberin", "Nein"],
          ],
        },
        {
          kind: "p",
          text: "`tests/authorization.test.ts` geht diese Tabelle mit einer Eigentümerin, einem dritten Konto und einseitigem Folgen durch; die Club-, Datenschutz- und Tausch-Tests decken die übrigen Rollen ab.",
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
            ["`NEXT_PUBLIC_SITE_URL`", "`http://localhost:3000`", "Basis der Canonicals, `sitemap.xml` und `robots.txt`. In Produktion Pflicht, immer `https://`."],
            ["`APP_ENCRYPTION_KEY`", "nicht gesetzt", "32 Byte in Hex oder Base64 für das TOTP-Geheimnis. Pflicht; `APP_ENCRYPTION_KEY_ID` und `APP_ENCRYPTION_OLD_KEYS` braucht nur, wer sie rotiert."],
            ["`WANDERBIBLIOTHEK_DB`", "`.data/wanderbibliothek.db`", "Pfad der SQLite-Datenbank (`:memory:` in Tests)."],
            ["`BREVO_API_KEY` / `MAIL_FROM`", "nicht gesetzt", "E-Mail direkt über die Brevo-API. `MAIL_FROM` erlaubt `Name <adresse@domain>`."],
            ["`MAIL_WEBHOOK_URL` / `MAIL_WEBHOOK_TOKEN`", "nicht gesetzt", "Alternative zu Brevo: empfängt `{to, subject, text}`; sind beide gesetzt, gilt der Webhook."],
            ["`MAINTENANCE_TOKEN`", "nicht gesetzt", "Token für `POST /api/cron/maintenance`; ohne ihn 404."],
            ["`TRUST_PROXY`", "nicht gesetzt", "`1` nur mit eigenem Proxy davor: erlaubt `X-Forwarded-For`/`-Host` und aktiviert Kontingente je IP."],
            ["`WANDERBIBLIOTHEK_BACKUP_KEY` / `WANDERBIBLIOTHEK_BACKUP_KEEP`", "nicht gesetzt / `14`", "Schlüssel der verschlüsselten Sicherungen und wie viele beim Rotieren bleiben."],
            ["`ERROR_WEBHOOK_URL` / `ERROR_WEBHOOK_TOKEN`", "nicht gesetzt", "Empfangen 500er als JSON, bereits redigiert."],
            ["`NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET`", "nicht gesetzt", "Aktivieren Cloudflare Turnstile bei der Registrierung."],
            ["`REQUIRE_EMAIL_VERIFICATION`", "nicht gesetzt", "`1` verlangt eine bestätigte Adresse zum Einstellen, Anfragen, Kommentieren und Schreiben."],
            ["`AUDIT_RETENTION_DAYS`", "`730`", "Tage, die `admin_audit` aufbewahrt wird (0 = dauerhaft)."],
            ["`LEGAL_*`", "nicht gesetzt", "Betreiber, Anschrift, Kontakt und optionale Angaben für `/privacidad` und `/aviso-legal`."],
            ["`MASTODON_*`", "aus", "Optionale Mastodon-Integration; ohne `MASTODON_TOKEN` aus."],
            ["`TRANSPARENCY_SIGNING_KEY`", "nicht gesetzt", "Ed25519-Schlüssel (PKCS#8 in Base64 oder PEM), der die tägliche Katalog-Momentaufnahme signiert. Ohne ihn werden sie unsigniert veröffentlicht und als solche gekennzeichnet."],
            ["`APP_COMMIT_SHA` / `APP_BUILD_TIME` / `APP_IMAGE`", "nicht gesetzt", "Build-Identität, die `/api/version` veröffentlicht; gefüllt vom Release-Workflow oder von `deploy/deploy.sh`."],
          ],
        },
        {
          kind: "p",
          text: "Die verbindliche Vorlage ist `deploy/env.example`: dort stehen alle, die aus dieser Tabelle und die Detailvariablen (Bot, Sicherungen, Demodaten, Google-Books-Kontingent, erster Administrator), kommentiert mit ihrem Standardwert.",
        },
      ],
    },
    {
      id: "tests",
      heading: "Tests und Continuous Integration",
      blocks: [
        {
          kind: "p",
          text: "`npm test` führt 931 Unit- und Integrationstests in 120 Dateien aus (Node-Testrunner auf SQLite im Speicher), und `npm run test:e2e` ergänzt 64 Browser-Tests mit Chromium, die einen eigenen Server auf Port 3100 starten; `npm run test:e2e:smoke` führt den WebCrypto-/IndexedDB-Smoke in Firefox und WebKit aus.",
        },
        {
          kind: "p",
          text: "`npm run test:coverage` setzt Mindestschwellen von 92 % Zeilen, 80 % Zweigen und 88 % Funktionen. Zwei Browser-Tests sind Leitplanken und keine Funktion: `e2e/accesibilidad.spec.ts` schickt **axe** (WCAG 2.0/2.1 A und AA) über Startseite, Katalog, eine Exemplarseite und den Anmeldedialog und scheitert an allem, was axe als `serious` oder `critical` meldet; `e2e/rendimiento.spec.ts` prüft, dass ein Katalogbesuch in ein **Byte-Budget** passt und kein Bild über 250 KB geht — der Riegel gegen die 1,3-MB-Originale. Das Budget wird am Produktions-Build gemessen und läuft daher nur in der CI. Die Continuous Integration (`.github/workflows/ci.yml`) führt `lint`, `typecheck`, `test`, `test:coverage`, `build`, `npm audit --omit=dev`, die Browser-Tests und einen Build des Docker-Images aus, das zusätzlich mit Trivy geprüft wird: der Job bricht nur bei **kritischen Schwachstellen mit Patch** ab, denn eine Warnung ohne verfügbare Korrektur lässt sich in dem Moment nicht beheben, bleibt aber im Protokoll.",
        },
        {
          kind: "p",
          text: "Jeder Lauf veröffentlicht eine **SBOM** in CycloneDX (`npm sbom`) mit den Produktionsabhängigkeiten: bei einer Warnung zeigt sie, ob diese Version je ausgeliefert wurde. `tests/no-secrets.test.ts` durchsucht den Arbeitsbaum nach Zugangsdaten (Brevo-Schlüssel, GitHub-Token, private Schlüssel, 32-Byte-Schlüssel, die einer Variablen mit Schlüsselnamen zugewiesen sind): läuft lokal und in der CI, ohne Dienst, und ersetzt nicht die Prüfung der git-Historie. Die statische Analyse (CodeQL mit `security-extended`) liegt separat in `.github/workflows/codeql.yml`, ebenfalls montags geplant, um neue Abfragen mitzunehmen.",
        },
        {
          kind: "p",
          text: "Die CI prüft auch die **Entwicklungsabhängigkeiten** (vollständiges `npm audit`): ESLint, TypeScript und Playwright bauen, was veröffentlicht wird. Das `minimatch@11`-`override` in `package.json` steht dort, weil `@typescript-eslint/typescript-estree` eine Version mit einer ReDoS-Warnung auflöste; es betrifft nur die ESLint-Kette, nicht die Laufzeit, und lässt sich entfernen, sobald diese Abhängigkeit sie selbst mitbringt.",
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
            "`npm run db:verify` ist die Wiederherstellungsprobe: entschlüsselt die neueste Sicherung (oder die übergebene), öffnet sie schreibgeschützt wie die Anwendung, führt `integrity_check` und `foreign_key_check` aus, prüft die Schemaversion und zählt die wichtigsten Tabellen. Bricht mit Fehler ab, wenn die Sicherung sich nicht wiederherstellen lässt.",
            "`POST /api/cron/maintenance` mit `Authorization: Bearer $MAINTENANCE_TOKEN` lässt Anfragen verfallen, räumt Sitzungen, Hinweise und Kontingente auf, löscht alte Aktivität (`events` und `product_events`, 180 Tage), erledigte Meldungen (1 Jahr), entschiedene Einsprüche (2 Jahre) und das Moderationsprotokoll nach `AUDIT_RETENTION_DAYS` und verschickt die Erinnerungen der Clubs.",
            "`npm run user:verify -- <adresse>` und `npm run admin:2fa-off -- <adresse>` sind die Notausgänge, wenn Mail oder zweiter Faktor jemanden aussperren.",
            "Von `route()` umschlossene Routen hinterlassen eine `[req] {…}`-Zeile und die Kopfzeile `x-response-time`; nginx protokolliert **jede Anfrage an die Anwendung** mit derselben `x-request-id`, die auch an den Client zurückgeht. Handgeschriebene Routen erzeugen diese Zeile noch nicht: die ausstehende Migration deckt sie nach und nach ab. `/api/metrics` (Administration oder das Wartungstoken) liefert p50/p95/p99-Latenz dieser Routen, Speicher, offene Streams, den Zustand der Arbeitswarteschlangen sowie Größe von Datenbank und WAL; mit `?format=prometheus` im Format, das ein Collector versteht. Die `reference` eines 500ers sind die ersten 8 Zeichen dieser ID.",
            "Eine Abfrage über 50 ms hinterlässt einen Hinweis `[db] consulta lenta` mit Dauer und gekürztem SQL: `better-sqlite3` ist synchron, und solange eine Abfrage läuft, steht der ganze Prozess. Der Cron liefert außerdem unter `db` die Größe der Datei, des WAL und die freien Seiten **nach** dem Checkpoint.",
            "Nur eine Instanz: SQLite hat einen einzigen Schreiber, horizontale Skalierung verlangt also PostgreSQL. Der Live-Kanal nicht: der Bus im Speicher spart nur Latenz, und die Quelle der Wahrheit ist eine Marke, die aus der Datenbank gelesen wird, sodass ein zweiter Prozess weiter funktioniert (bis zu 15 s Verzögerung zwischen Instanzen). Ein gemeinsamer Bus würde diese Verzögerung beseitigen, nicht den Betrieb ermöglichen.",
            "Gemessene Obergrenze mit `npm run bench:sqlite`: rund 100 000 Einzel-Schreibvorgänge/s, über 200 000/s im Stapel, rund 300 000 Lesezugriffe/s über den Primärschlüssel und 2 000/s bei einem Filter ohne Index über 5 000 Zeilen. Die echte Grenze ist die Dauer jeder Transaktion, nicht die Zahl der Aufrufe.",
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
            "`deploy/wanderbibliothek-maintenance.timer` (alle 15 Minuten) und `deploy/wanderbibliothek-backup.timer` (alle 6 Stunden).",
            "Alternativ `Dockerfile` und `docker-compose.yml`, mehrstufig und nur mit Produktionsabhängigkeiten; der Image-Build wird in der CI geprüft.",
            "Fehlt eine Pflichtvariable in der Konfiguration, startet der Prozess zwar, antwortet aber auf alles mit 500 und dem Grund im Log, statt funktionsfähig zu wirken.",
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
            "Eine einzige Struktur (`SiteShell`) für die internen Seiten; die Startseite ist die Ausnahme und überlässt dem Katalog die volle Breite.",
            "Farben kommen aus Tokens (`src/app/styles/tokens.css`): außerhalb dieser Datei gibt es keine Literale, deshalb teilen helles und dunkles Thema dasselbe Markup.",
            "Vier Breakpoints (480, 768, 1120 und 1400/1800 px), Abstandsstaffel von 4 bis 48 px und Bedienelemente mit 40 px, mobil 44 px.",
            "Dialoge mit gefangenem Fokus, Schließen per `Escape` und Fokus-Rückgabe; Sprunglink „Zum Inhalt“, `aria-current` in der Navigation, Filter mit `aria-pressed` und Fehler mit `role=\"alert\"`.",
            "Was beim Laden nicht zu sehen ist, reist nicht im Startpaket: Anmeldedialog, Tauschdialog (Kryptografie und QR), Veröffentlichungsformular, Benachrichtigungen sowie Community- und Tauschansicht kommen per `next/dynamic`, wenn sie geöffnet werden. Die Browser-Kryptografie wird beim Veröffentlichen des Schlüssels geladen, nicht beim Start. Vorsicht bei `dynamic` für etwas, das immer eingebunden ist: ohne `loading` suspensiert sein Laden den ganzen Baum und die Seite reagiert spät (abgedeckt von `e2e/app.spec.ts` über den Fokus des Herzens).",
            "Mindestkontrast AA, Schrift ab 12 px, Touch-Ziele mit 44 px auf dem Handy und `prefers-reduced-motion` wird respektiert: die Animationen (in `styles/motion.css`) bewegen nur `opacity` und `transform` und entfallen mit dieser Einstellung ganz.",
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
              note: "Herkunftsnachweise für das Titelbild und die Komponenten von Drittanbietern.",
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
