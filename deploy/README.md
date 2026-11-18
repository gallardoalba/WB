# Despliegue en un servidor (systemd + nginx)

Receta para poner Wanderbibliothek en un host Linux propio, con TLS, servicio
supervisado, tareas programadas y copias de seguridad. La aplicación es una sola
instancia de Node con SQLite: **no** se puede replicar horizontalmente (ver
«Límites conocidos»).

## 0. Vía rápida: los dos scripts

Si prefieres no lanzar los apartados uno a uno, el repositorio trae dos:

```bash
# Primera instalación en un servidor vacío (Debian/Ubuntu, como root).
sudo deploy/bootstrap.sh --domain tu-dominio.de --email tu@correo.de

# Cada versión nueva: trae el código de GitHub y cambia de release.
sudo /srv/wanderbibliothek/current/deploy/deploy.sh
```

- **`deploy/bootstrap.sh`** instala Node 24, nginx y certbot, crea el usuario y
  los directorios, clona y compila, genera `/etc/wanderbibliothek/env` con
  secretos nuevos, coloca el servicio y los temporizadores, publica el vhost y
  pide el certificado. No pisa un `env` existente ni un vhost sin guardar copia,
  y se niega a seguir si Apache ocupa los puertos 80/443.
- **`deploy/deploy.sh`** crea una release en `releases/<fecha>-<commit>`, la
  compila, **hace copia de la base** antes de cambiar nada, mueve `current`,
  reinicia y comprueba `/api/health`. Si la comprobación falla, vuelve solo a la
  versión anterior. Acepta `--ref` (etiqueta o commit), `--rollback`, `--keep N`
  y `--dry-run`.

### Elegir el modo de despliegue

| Modo | Qué ejecuta | Actualización | Uso recomendado |
|---|---|---|---|
| **Imagen firmada** | El digest inmutable de GHCR; backup y assets públicos salen de esa misma imagen. El watchdog se instala en una ruta fija del host. | `wanderbibliothek-deploy-image --ref <versión>` | Recomendado para que terceros puedan contrastar el artefacto con GitHub. |
| **Código** | La release bajo `current`; el backup usa su script y la aplicación Node del host. | `current/deploy/deploy.sh` | Alternativa para hosts sin Docker o para desarrollo. |

`deploy.sh` se conserva como alternativa deliberada, no como camino de
actualización de la instancia por imagen. Una vez instalado el desacople descrito
en el apartado 11, systemd, nginx y las tareas programadas del modo imagen no
necesitan `current`. Esto hace coherentes el digest anunciado, los assets
servidos y el código de la copia; no es una atestación del host y una persona
con acceso root todavía puede cambiar Docker, systemd o nginx.

Los dos aceptan `--dry-run` y explican cada paso con `OK/AVISO/FALLO`. Lo que
ninguno puede adivinar —correo, Impressum, cuenta de administración— queda
listado al final de la ejecución. Los apartados siguientes son la versión manual
paso a paso, útil para entender qué hace cada cosa o para depurar.

## 1. Requisitos

- Debian 12 / Ubuntu 22.04 o similar, 1 vCPU y 1 GB de RAM bastan para empezar.
- Node.js 22 (NodeSource o nvm instalado a nivel de sistema).
- nginx y certbot: `sudo apt install nginx certbot python3-certbot-nginx`.
- `build-essential` y `python3` por si `better-sqlite3` no encuentra binario
  precompilado para tu versión de Node.

### Debian 13 (trixie)

Funciona igual, con tres detalles que cambian respecto a Debian 12:

- El `nodejs` de los repositorios es la 20 y aquí hace falta la 24: instálala
  desde NodeSource (`curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -`)
  o con nvm de sistema, y comprueba que `node -v` da 24 antes del `npm ci`.
- nginx es 1.26 o superior: `listen 443 ssl http2;` está obsoleto y `nginx -t`
  avisa en cada recarga. `deploy/nginx.conf` ya trae la forma buena
  (`listen 443 ssl;` + `http2 on;`); en una instalación anterior, cambia esas
  dos líneas a mano.
- Con 1 GB de RAM, `npm run build` es lo más hambriento del proceso: añade 2 GB
  de swap antes de compilar en el servidor
  (`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`,
  y la línea correspondiente en `/etc/fstab`), o compila en tu equipo y copia la
  release ya construida.

## 2. Usuario y directorios

```bash
sudo useradd --system --home /srv/wanderbibliothek --shell /usr/sbin/nologin wanderbibliothek
sudo mkdir -p /srv/wanderbibliothek/releases /var/lib/wanderbibliothek /var/backups/wanderbibliothek
sudo chown -R wanderbibliothek:wanderbibliothek /srv/wanderbibliothek /var/lib/wanderbibliothek /var/backups/wanderbibliothek
```

- `/srv/wanderbibliothek/releases/<fecha>/` — cada versión desplegada.
- `/srv/wanderbibliothek/current` — enlace simbólico a la versión activa.
- `/var/lib/wanderbibliothek/wanderbibliothek.db` — la base (fuera de la aplicación).
- `/var/backups/wanderbibliothek/` — copias.
- `/etc/wanderbibliothek/env` — variables de entorno del servicio (solo root).

## 3. Instalación de dependencias

```bash
cd /srv/wanderbibliothek/releases/2026-11-04
npm ci
npm run build
```

`npm ci` instala también devDependencies porque el **build** necesita
TypeScript, Tailwind y ESLint. En ejecución basta con `npm ci --omit=dev`:
`tsx` (lo que usan `admin:create`, `db:backup`, `user:verify` y `smoke`) es
dependencia de producción a propósito. Si prefieres adelgazar la release, tras
el `npm run build` puedes ejecutar `npm prune --omit=dev`.

El build **no** necesita base de datos ni variables de entorno: se puede hacer
en CI y desplegar el artefacto.

## 4. Entorno

```bash
sudo mkdir -p /etc/wanderbibliothek
sudo install -m 600 -o root -g root deploy/env.example /etc/wanderbibliothek/env
sudo -e /etc/wanderbibliothek/env          # rellena URL, correo y secretos
```

Genera los secretos con `openssl rand -hex 32`. Las variables obligatorias y sus
consecuencias están comentadas en el propio fichero; el resumen:

| Variable | Si falta |
|---|---|
| `NEXT_PUBLIC_SITE_URL` (https) | Sitemap y canonical apuntan a localhost; con `http://` el navegador descarta la cookie `__Host-` y el login entra en bucle |
| `BREVO_API_KEY` + `MAIL_FROM` (o `MAIL_WEBHOOK_URL`) | Nadie puede confirmar el correo (obligatorio para publicar en producción) ni recuperar la contraseña |
| `APP_ENCRYPTION_KEY` | No se puede guardar el secreto TOTP; sin 2FA la administración responde 403 en producción |
| `APP_ENCRYPTION_OLD_KEYS` | Solo se usa al **rotar** la clave: la nueva en `APP_ENCRYPTION_KEY`, la anterior aquí para seguir leyendo |
| `MAINTENANCE_TOKEN` | El cron responde 404: sin purgas, sin reintentos de correo, sin recordatorios de club |
| `TRUST_PROXY=1` | Todas las peticiones comparten la cuota global: un cliente puede agotar el login del sitio |
| `WANDERBIBLIOTHEK_DB` | La base se crea dentro de la release y se pierde en el siguiente despliegue |
| `WANDERBIBLIOTHEK_BACKUP_KEY` | La copia se guarda en claro con correos, hashes de contraseña y los mensajes dentro, y esa copia acaba fuera del servidor |
| `LEGAL_CONTROLLER` / `LEGAL_ADDRESS` / `LEGAL_CONTACT_EMAIL` | `/privacidad` y `/aviso-legal` salen con un aviso de que faltan datos; el Impressum es obligatorio en Alemania |
| `MASTODON_TOKEN` | El bot no publica: el catálogo funciona igual, solo no hay avisos en el perfil |

Al arrancar, `[env]` también avisa (sin bloquear) de los errores que solo se
notarían semanas después: un `MAINTENANCE_TOKEN` de menos de 24 caracteres,
rutas de base o de copias relativas, `TRUSTED_PROXY_HOPS` no numérico y
`ADMIN_EMAIL`/`ADMIN_PASSWORD` a medias. La clave de las copias no está en esa
lista: vacía o mal escrita **impide arrancar**, porque lo que se juega es una
base con correos y hashes en claro.

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` (captcha opcional) se **incrusta en el bundle
del cliente**: si lo activas, tiene que existir en el momento del `build`, no
solo en el entorno del servicio. En Docker se pasa como build arg (apartado 11).

> **¿Prefieres contenedores?** Salta al [apartado de Docker](#11-docker) más
> abajo: el mismo entorno sirve, con `WANDERBIBLIOTHEK_DB=/data/wanderbibliothek.db`.

### Correo: Brevo, integrado en la aplicación

La entrega está resuelta dentro del código (`src/lib/mailer.ts`): con
`BREVO_API_KEY` y `MAIL_FROM` definidas, los envíos van directamente a
`POST https://api.brevo.com/v3/smtp/email`. No hay adaptador, ni Worker, ni una
segunda URL pública que proteger. Solo se envían dos correos de texto plano
—confirmación de cuenta y restablecer contraseña—, así que el plan gratuito
(300 al día) sobra.

1. **Cuenta**: brevo.com. La empresa es Sendinblue SAS (París) y los datos se
   tratan en la UE. Aun así, antes de dar por hecho que no hay nada que declarar
   en `/privacidad`, revisa el contrato de encargo del tratamiento, sus
   subencargados y los accesos desde fuera del EEE: la sede europea no lo decide
   todo.
2. **Autenticar el dominio**: *Senders, Domains & Dedicated IPs → Domains* →
   añade `wanderbibliothek.org`. Brevo muestra los registros exactos: dos o tres
   **CNAME de DKIM**, un **TXT de DMARC** y el `include:` del **SPF**. En netcup
   CloudDNS se pegan tal cual; si el dominio ya tiene un SPF (por ejemplo, del
   correo), los `include:` se suman en **una sola** línea.
3. **Clave de API**: *SMTP & API → API Keys (v3)*, con permiso de envío. Va en
   `BREVO_API_KEY`; el remitente, en `MAIL_FROM`.

```bash
sudo -e /etc/wanderbibliothek/env
#   BREVO_API_KEY=xkeysib-…
#   MAIL_FROM="Wanderbibliothek <no-reply@wanderbibliothek.org>"
sudo systemctl restart wanderbibliothek
```

Cuatro trampas que dan un 401/400 difícil de leer:

- **IP no autorizada.** Si activas *Seguridad → IP autorizadas* en Brevo, la API
  solo acepta peticiones desde esas direcciones: añade la del servidor o deja la
  opción desactivada. El registro dirá `Brevo rechazó el envío 401 ·
  unauthorized` y el mensaje ya apunta a esa pantalla.
- **Remitente sin verificar.** `MAIL_FROM` tiene que salir de un dominio (o un
  remitente suelto) validado en la cuenta, nunca de un dominio ajeno.
- **Remitente de dominio gratuito.** Un `MAIL_FROM` con `@gmail.com`,
  `@protonmail.com` o similar no puede alinearse con DMARC —no controlas su SPF
  ni su DKIM— y Gmail lo rechaza o lo manda a spam. El remitente debe ser del
  dominio autenticado, aunque el buzón no exista (`no-reply@`).
- **El código de Brevo va en la raíz.** El TXT `brevo-code:<hash>` se publica en
  `@`, no en un subdominio llamado `brevo-code`: puesto ahí, Brevo lo da por
  ausente aunque `dig` lo devuelva.
- **«Los registros no coinciden» cuando el DNS ya está publicado.** Es caché
  negativa: en el portátil, `systemd-resolved` (`sudo resolvectl flush-caches`);
  en el verificador de Brevo, el `NXDOMAIN` que guardó antes de crear los
  registros, con la vida del mínimo del SOA. Comprobar con `dig @1.1.1.1` antes
  de tocar nada.

`DMARC` mejor en `p=none` al principio: si algo falla, los correos llegan igual
y el informe dice qué.

### Otros proveedores: `MAIL_WEBHOOK_URL`

La segunda vía es un webhook genérico: `POST` con
`{"to": "…", "subject": "…", "text": "…"}` y, si defines `MAIL_WEBHOOK_TOKEN`,
`Authorization: Bearer <token>`. La aplicación no manda remitente, así que el
adaptador decide el `from`. Sirve para Resend (`POST /emails`, empresa de
EE. UU.), Scaleway TEM o Mailjet (UE), Amazon SES (hay que salir del *sandbox*) o
un Worker propio. Si defines esta URL **y** `BREVO_API_KEY`, manda el webhook y
el arranque avisa de que la clave de Brevo se está quedando sin usar.

En cualquiera de los dos caminos hay dos pasos que se olvidan y luego caen en
spam: publicar **SPF y DKIM** (y un `DMARC` en `p=none` para empezar) en el DNS
del dominio, no solo en el panel del proveedor, y usar un remitente del propio
dominio, no `no-reply@` de uno ajeno.

**Probarlo** sin esperar a que alguien se registre: el script envía un correo de
prueba por el mismo camino que los de verdad (no toca la base). Lee
`/etc/wanderbibliothek/env` por su cuenta —lo que exportes a mano manda—, así
que no hay que repetir la clave en la orden. Va con `sudo` a secas: con
`sudo -u wanderbibliothek` no puede leer el fichero (es 600 de root) y diría
«no hay proveedor configurado» con la clave puesta.

```bash
sudo npm --prefix /srv/wanderbibliothek/current run mail:test -- tu@correo
```

Si sale `Aceptado por el proveedor`, el resto —la cola, los enlaces de un solo
uso— también funciona. Para ver el flujo completo, pide un restablecimiento desde
`/restablecer` y mira el registro:

```bash
sudo journalctl -u wanderbibliothek -n 50 | grep '\[mail\]'
```

Si aparece `entrega fallida: el mensaje sigue en la cola`, el motivo concreto
—el 401 o el 400 con el `code` de Brevo— está una línea antes. El cron
(`/api/cron/maintenance`) reintenta con espera creciente hasta cinco veces.

**Comprobar que el dominio inspira confianza.** `mail:test` dice si el proveedor
acepta el mensaje; no dice si el buzón lo va a querer. Eso depende de tres
registros DNS y de la cola real:

```bash
sudo npm --prefix /srv/wanderbibliothek/current run mail:health
# o en JSON, para encadenarlo:
sudo npm --prefix /srv/wanderbibliothek/current run mail:health -- --json
```

Lee `MAIL_FROM` para saber el dominio y `MAIL_DKIM_SELECTOR` (el nombre que da
el proveedor: `brevo`, `s1`, `mail`…) para buscar la clave pública. Comprueba
SPF, DMARC —avisa si está en `p=none`, que observa el fallo pero no protege el
dominio— y la firma DKIM; además cuenta los correos pendientes, los dados por
perdidos en 24 h y lo que lleva esperando el más antiguo. Sale 1 si hay algo que
arreglar, y el vigilante mira la cola por su cuenta cada 15 minutos.

### Bot de Mastodon (opcional)

Con `MASTODON_TOKEN` definido, cada obra que publica una **cuenta de administración**
se anuncia en el perfil del proyecto; lo que ofrece la comunidad no llega a la
cola. Los avisos salen **siempre en alemán**, sea cual sea el idioma del
ejemplar. El token se crea en la instancia —**Preferencias →
Desarrollo → Nueva aplicación**— con los permisos `write:statuses`, `write:media`
(para adjuntar la portada) y `read:accounts`; el tercero es el que usa
`mastodon:test` para comprobar que la credencial vale. Para los «me gusta» hace
falta además **`write:favourites`**: sin ese permiso la instancia contesta 403.

El formulario pide un **URI de redirección** que aquí no se usa nunca (el token
se copia de la propia página de la aplicación, no se pide por OAuth): sirve
`urn:ietf:wg:oauth:2.0:oob`, el valor que la documentación de Mastodon reserva
para las aplicaciones que muestran el código en pantalla. Tiene que ser una URI
absoluta; si la instancia lo rechazara, `https://wanderbibliothek.org/` vale
igual.

```bash
# Solo comprueba: dice quién es el token y enseña el texto, sin publicar nada
sudo npm --prefix /srv/wanderbibliothek/current run mastodon:test

# El aviso de una obra concreta, y su publicación de verdad
sudo npm ... run mastodon:test -- --libro bok_123
sudo npm ... run mastodon:test -- --media bok_123   # sube la portada sin publicar
sudo npm ... run mastodon:test -- --enviar bok_123

# Reintentar lo que quedó pendiente (el cron también lo hace cada hora)
sudo npm ... run mastodon:test -- --cola

# Repasar lo ya publicado: enlaces y avisos que siguen en otro idioma
sudo npm ... run mastodon:test -- --publicadas
```

Lo que hay que saber:

- **Solo la administración anuncia.** El aviso se encola únicamente cuando el
ejemplar lo publica una cuenta con `is_admin`: el perfil cuenta lo que cataloga
el equipo, no lo que pone a la venta la comunidad. `announceBook` exige la marca
(`isAdmin`) y sin ella no hace nada, así que una ruta nueva no puede saltarse la
regla por olvido. El envío manual (`--enviar`) cuenta como administración.
- **Un aviso por obra, no por ejemplar.** Si tres personas ponen el mismo libro,
  el perfil no lo repite: la tabla `social_outbox` tiene una clave única por red
  y obra.
- **Y uno por persona y día.** Quien cataloga su estantería de una sentada no
  convierte el perfil en una lista de la compra: se anuncia el primer libro del
  día y los demás se quedan sin aviso. El día se cuenta en hora alemana
  (Europe/Berlin), no en UTC. El envío a mano (`--enviar`) no pasa por ese tope.
- **Y espaciados.** Si se publican varias obras de golpe, la primera sale en el
  acto y las demás esperan un hueco aleatorio de **4 a 7 horas**
  (`MASTODON_GAP_MINUTES`, por defecto `240-420`) para que el perfil no parezca
  un robot. Con `0` no hay espera: solo para una prueba desde la web.
- **Registro sobrio**: una frase enunciativa, sin emoji ni exclamaciones, el
  enlace y tres etiquetas. Hay cien formulaciones, siempre en alemán, y la
  variante se elige con un hash del id de la obra, así que el mismo libro siempre
  se anuncia igual. Las etiquetas combinan la casa, el tema del libro (sus
  etiquetas curadas o su categoría) y la lectura; no hay etiquetas de librerías.
- **Los avisos anteriores al cambio siguen en el idioma del ejemplar.** Mastodon
  permite editar una publicación, así que `--publicadas` lista los avisos ya
  enviados que llevan enlace `/es` o `/en` o las etiquetas antiguas, con su
  enlace directo y el texto, para traducirlos a mano. No toca nada y no necesita
  token: lee la cola, donde está anotada cada publicación.
- **La portada viaja como imagen adjunta**, con texto alternativo en alemán. La
  imagen se sube **antes** de encolar el post y su id se guarda en la fila: un
  reintento adjunta el mismo medio en vez de subirlo otra vez. Si no hay portada
  —o la instancia rechaza la imagen— el aviso sale solo con texto.
- **El post se encola en la base.** Si la instancia no contesta, el aviso no se
  pierde: se reintenta con espera creciente (5 intentos) desde el cron. Un token
  revocado o un texto inválido se marcan como fallidos sin reintentar.
- **Idempotencia.** Cada envío lleva `Idempotency-Key` con el id de la fila, así
  que un reintento no publica dos veces el mismo estado.
- **Sin datos personales**: título, autoría y enlace a `/werk/<obra>`. Ni ciudad
  ni nombre de quien publica.
- **En desarrollo no se publica**: si `NEXT_PUBLIC_SITE_URL` es localhost, el
  aviso se descarta antes de encolarse.

Si un post no sale, el motivo está en la propia cola:

```bash
sudo sqlite3 /var/lib/wanderbibliothek/wanderbibliothek.db \
  "select subject, status, attempts, last_error from social_outbox order by created_at desc limit 10;"
```

#### «Me gusta» a publicaciones sobre libros (opcional)

Con `MASTODON_LIKES=on` el bot también lee: recorre las líneas de tiempo de
etiquetas de libros y pulsa el corazón de lo que parece una persona hablando de
un libro. **Está apagado por defecto** porque actúa sobre lo que escriben otras
personas; sin esa variable no hace ni una petición.

Todo lo que hay debajo existe para que no parezca spam:

- **Por etiqueta, nunca por búsqueda libre.** Etiquetas de libros en los tres
  idiomas de la casa —`#Bücher`, `#Buch`, `#Lesen`, `#Literatur`, `#Buchtipp` ·
  `#Libros`, `#Lectura`, `#Libro`, `#Literatura` · `#Books`, `#Bookstodon`,
  `#Reading`, `#BookRecommendation`— y se descarta lo que no está escrito en el
  idioma de su etiqueta. Con `MASTODON_LIKES_TAGS` se pueden poner otras
  (separadas por comas) y con `MASTODON_LIKES_LOCALES=de` se puede dejar solo
  en alemán.
- **Solo cuentas que leen.** Además de la etiqueta, la **biografía** de la cuenta
  tiene que hablar de libros («Bücherwurm», «Leseratte», «Rezensionen»,
  «Buchhandlung»…): el corazón va a personas que hablan de libros, no a cuentas
  que sueltan la etiqueta para ganar alcance.
- **Pocos y espaciados.** `MASTODON_LIKES_PER_DAY` (40 por defecto, máximo 60) en
  una ventana de 24 h y `MASTODON_LIKES_MIN_GAP_MINUTES` (25, mínimo 5) entre dos
  pulsaciones. El cron pasa cada 15 minutos, así que dos «me gusta» nunca caen
  seguidos.
- **Una por cuenta y día.** Si alguien publica cuatro cosas sobre libros, se le
  pulsa una; el resto parecería acoso (`MASTODON_LIKES_PER_ACCOUNT`, 1 a 3).
- **Solo lo legible sin cuenta**: estados públicos o no listados, originales
  (nada de boosts), sin marcar como sensibles, con texto de más de 60 caracteres
  y una palabra de libros dentro, de los últimos siete días.
- **Memoria**: `social_likes` guarda cada estado pulsado (clave única por red y
  estado), así que el mismo post no se repite nunca. Se purga a los 180 días.

```bash
# Enseña qué le gustaría, sin pulsar nada (y sin gastar cuota de «me gusta»)
sudo npm --prefix /srv/wanderbibliothek/current run mastodon:test -- --gustar

# Lo pulsa de verdad
sudo npm ... run mastodon:test -- --gustar-enviar

# Historial de los últimos «me gusta»
sudo npm ... run mastodon:test -- --gustos
```


## 5. Servicio, proxy y tareas programadas

```bash
sudo cp deploy/wanderbibliothek.service deploy/wanderbibliothek-maintenance.service \
        deploy/wanderbibliothek-maintenance.timer deploy/wanderbibliothek-backup.service \
        deploy/wanderbibliothek-backup.timer deploy/wanderbibliothek-watchdog.service \
        deploy/wanderbibliothek-watchdog.timer deploy/wanderbibliothek-verify.service \
        deploy/wanderbibliothek-verify.timer /etc/systemd/system/
sudo install -m 755 deploy/run-backup-container.sh /usr/local/sbin/wanderbibliothek-backup
sudo install -m 755 deploy/run-verify-backup.sh /usr/local/sbin/wanderbibliothek-verify
sudo install -m 755 deploy/watchdog.sh /usr/local/sbin/wanderbibliothek-watchdog
sudo install -Dm644 deploy/backup-key.sh /usr/local/lib/wanderbibliothek/backup-key.sh
# Endurecimiento: ProtectSystem=strict, topes de memoria y la caché de Next
# escribible (`ReadWritePaths`), que es donde `sharp` guarda las tallas.
sudo install -Dm644 deploy/wanderbibliothek-hardening.conf \
  /etc/systemd/system/wanderbibliothek.service.d/hardening.conf
sudo ln -sfn /srv/wanderbibliothek/releases/2026-11-04 /srv/wanderbibliothek/current
sudo systemctl daemon-reload
sudo systemctl enable --now wanderbibliothek wanderbibliothek-maintenance.timer \
  wanderbibliothek-backup.timer wanderbibliothek-watchdog.timer \
  wanderbibliothek-verify.timer

sudo cp deploy/nginx.conf /etc/nginx/sites-available/wanderbibliothek
# Caché de imágenes del proxy (portadas): nginx la necesita creada y escribible.
sudo install -d -o www-data -g www-data -m 700 /var/cache/nginx/wb_images
# Bloqueo de rastreadores de IA por User-Agent (contexto `http`).
sudo install -m 644 deploy/nginx-ai.conf /etc/nginx/conf.d/wanderbibliothek-ai.conf
sudo ln -s /etc/nginx/sites-available/wanderbibliothek /etc/nginx/sites-enabled/
# El `nginx.conf` declara el `default_server` de 80 y 443 para cerrar la
# conexión a quien llega por la IP desnuda o por un dominio que no atendemos.
# Debian trae el suyo en `sites-enabled/default`: con los dos, `nginx -t` falla
# con «duplicate default server».
sudo rm -f /etc/nginx/sites-enabled/default
sudo certbot --nginx -d biblioteca.example.com
sudo nginx -t && sudo systemctl reload nginx
```

La unidad escucha en `127.0.0.1:3000`; lo público lo sirve nginx. La ubicación
`^~ /api/requests` (la ruta exacta y todo lo que cuelga de ella) va sin
buffering y con timeout largo: ahí vive el canal de mensajería en vivo (SSE).
⚠ Ese prefijo tiene que casar también con el listado **sin** barra final: con
`location /api/requests/` la petición caía en `location /`, Next respondía 301
a `/api/requests/` y la regla la devolvía a `/api/requests` (bucle que la app no
sigue). Si la app dice «el servidor redirige en bucle», falta copiar este
`nginx.conf` y recargar.

El `nginx.conf` de `deploy/` añade tres cosas que la aplicación no puede hacer
sola:

- **Límite de ritmo en el borde** (`limit_req`): 10 peticiones/minuto por IP en
  `/api/auth/*` y **120/minuto (2 por segundo, con margen de 120)** en el resto.
  La app ya limita en SQLite, pero cada intento rechazado sigue siendo una
  escritura: el límite del proxy evita que un flood convierta el disco en el
  cuello de botella. El margen cubre una carga de página normal (~30 ficheros de
  golpe) y sigue cortando los barridos de cientos de peticiones; con 300/minuto
  y margen 300 **ningún escáner lo tocaba**. Si pones un CDN delante, configura
  `real_ip` o el límite agrupará a todos los visitantes en la IP del CDN.
- **Rutas de escáner con `444`**: `.php`, `.env`, `/.git`, `/wp-*`, `.sql`,
  `.bak`, `.old`, `.swp` y `.DS_Store` cierran la conexión sin respuesta y sin
  llegar a Node. Se registran en el `access.log` con estado 444, así que el jail
  `wb-nginx-scan` sigue contándolas. Ninguna ruta real de la aplicación contiene
  esos patrones.
- **`/api/cron/maintenance` solo desde el propio host** (`allow 127.0.0.1;`): el
  token ya la protege, pero no hay razón para exponer una tarea de escritura.
- **TLS sin tickets de sesión** (nginx no rota esa clave por sí solo).
- **Compresión y estáticos en el borde.** El vhost activa `gzip` (con
  `gzip_proxied any`, sin él no comprime lo que viene de Node) y sirve
  `public/{fonts,icons,hero}/` desde el disco de la release activa. Los assets
  de `/_next/static/` pasan por el contenedor que generó el HTML: así no se
  mezclan los ficheros del checkout operativo con los de la imagen desplegada.
  Next sirve esos assets con caché inmutable solo cuando existen; el hash se
  separa por commit para que los navegadores no reutilicen errores 404 de una
  versión previa. Por eso la aplicación va con `compress: false` en
  `next.config.ts`: comprimir en los dos sitios solo gastaba CPU.
- **Caché de imágenes en el borde** (`proxy_cache`, zona `wb_images`). Las
  portadas —lo más pesado que sirve la aplicación— y sus versiones reducidas de
  `/_next/image` se guardan en `/var/cache/nginx/wb_images` (1 GB como mucho, un
  mes sin tocarse) y las sirve nginx sin llegar a Node. La clave es la URL, que
  lleva la versión de la portada (`?v=…`): sustituir una imagen es una clave
  nueva, así que no hay nada que invalidar a mano. `/_next/image` negocia WebP o
  AVIF con `Accept` y responde `Vary: Accept`; como la caché de nginx no mira
  `Vary`, el formato entra en la clave (`$wb_image_format`, tres valores como
  mucho) para no servir a un navegador el WebP guardado para otro. Solo se
  cachean `GET`/`HEAD`: subir o borrar una portada (`PUT`/`DELETE`) sigue
  llegando a la aplicación. Para ver qué hace, mira la cabecera
  `X-Cache-Status` (`HIT`, `MISS`, `STALE`, `UPDATING`); para vaciarla,
  `sudo rm -rf /var/cache/nginx/wb_images/*` y recarga.
- **HTTP/3** (`listen 443 quic` + `Alt-Svc`) con el módulo `http_v3_module` de
  Debian. Hay que abrir UDP: `sudo ufw allow 443/udp`. Si el navegador no lo
  negocia, sigue por HTTP/2 sin cambiar nada.
- **Sin `POST` a la raíz.** La aplicación no tiene Server Actions, así que un
  `POST /` solo puede ser una sonda: `location = /` lo cierra con `444`. El
  filtro de fail2ban cuenta esas líneas como escaneo.
- **Cuota propia para `/es/…` y `/en/…`** (`wb_lang`, 60/minuto con margen 30):
  son las mismas páginas que la ruta sin prefijo, para SEO, y un rastreador las
  recorre todas. Un humano pasa por una o dos.
- **Rastreadores de IA**: `deploy/nginx-ai.conf` responde `403` por User-Agent
  (con `robots.txt` y el sitemap exentos). ⚠ Su lista tiene que coincidir con
  `AI_TRAINING_BOTS` de `src/app/robots.ts`; al añadir uno, se tocan los dos.

Si además usas fail2ban (recomendado), dos jails cubren el borde. Las plantillas
están en `deploy/fail2ban/`:

```bash
sudo cp deploy/fail2ban/wb-nginx-scan.conf /etc/fail2ban/filter.d/
sudo cp deploy/fail2ban/wanderbibliothek.local /etc/fail2ban/jail.d/
sudo fail2ban-client reload
```

```ini
[wb-nginx-scan]     # 5 respuestas 4xx de escáner en 1 h → 1 día de ban
filter = wb-nginx-scan
logpath = /var/log/nginx/wanderbibliothek.access.log

[wb-nginx-limit]    # 5 «limiting requests» en 10 min → 1 h de ban
filter = nginx-limit-req
logpath = /var/log/nginx/wanderbibliothek.error.log
ignoreip = 127.0.0.1/8 ::1 <IP pública del servidor>
```

El `ignoreip` del segundo jail importa: fail2ban ya ignora la IP propia
(`ignoreself`), pero conviene dejarlo escrito porque el propio servidor pide su
sitio público al generar la tarjeta social de cada libro, y una IP baneada
rompería esos anuncios.

### `www` y la forma canónica

El `server_name` del fichero es un único nombre. Si quieres atender también
`www.`, **no lo añadas al mismo bloque**: redirígelo al canónico. La sesión es
una cookie `__Host-` (atada al host exacto) y las claves de cifrado de la
mensajería viven en IndexedDB por origen, así que quien entre por `www.` sería,
a efectos prácticos, otra persona: otra sesión y otras claves, con los mensajes
antiguos ilegibles.

```nginx
# /etc/nginx/sites-available/wanderbibliothek-www
server {
    listen 80;
    listen [::]:80;
    server_name www.tu-dominio.de;
    return 301 https://tu-dominio.de$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name www.tu-dominio.de;
    ssl_certificate     /etc/letsencrypt/live/tu-dominio.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tu-dominio.de/privkey.pem;
    return 301 https://tu-dominio.de$request_uri;
}
```

Pide el certificado con los dos nombres (`certbot --nginx -d tu-dominio.de -d
www.tu-dominio.de`) para que el bloque de `www` tenga TLS válido; si no, el
navegador corta antes de leer la redirección. Y en `NEXT_PUBLIC_SITE_URL` pon
siempre **la forma canónica**.

## 6. Primer arranque

```bash
sudo systemctl start wanderbibliothek
sudo journalctl -u wanderbibliothek -f          # busca líneas [env]
curl -fsS https://biblioteca.example.com/api/health
```

La primera petición crea la base y aplica las 52 migraciones (de la v3 a la
v54), así que puede tardar unos segundos: hazla tú con el `curl` en lugar de
dejarla al primer visitante.

Si el entorno está incompleto, el servicio **arranca pero responde 500** y deja
el motivo en el log (`[env] ERROR …`). Es deliberado: se ve en `systemctl status`
sin entrar en un bucle de reinicios.

Administración:

```bash
sudo -u wanderbibliothek ADMIN_PASSWORD='contraseña-larga' \
  npm --prefix /srv/wanderbibliothek/current run admin:create -- admin@biblioteca.example.com
```

Entra en `/cuenta`, activa la verificación en dos pasos (obligatoria para
moderar en producción) y después **borra `ADMIN_PASSWORD`** del entorno:

```bash
sudo -e /etc/wanderbibliothek/env      # elimina ADMIN_EMAIL y ADMIN_PASSWORD
sudo systemctl restart wanderbibliothek
```

Comprobación final:

```bash
BASE_URL=https://biblioteca.example.com npm --prefix /srv/wanderbibliothek/current run smoke
```

## 7. Despliegue de una versión nueva

```bash
# 1) Copia antes de tocar nada (las migraciones no se deshacen solas)
sudo systemctl start wanderbibliothek-backup.service

# 2) Nueva release y build (puede hacerse en CI y copiarse)
cd /srv/wanderbibliothek/releases && git clone --depth 1 … 2026-11-20
cd 2026-11-20 && npm ci && npm run build

# 3) Cambiar el enlace y reiniciar
sudo ln -sfn /srv/wanderbibliothek/releases/2026-11-20 /srv/wanderbibliothek/current
sudo systemctl restart wanderbibliothek

# 4) Comprobar y, si algo va mal, volver atrás
curl -fsS https://biblioteca.example.com/api/health
BASE_URL=https://biblioteca.example.com npm --prefix /srv/wanderbibliothek/current run smoke
# vuelta atrás:
# sudo ln -sfn /srv/wanderbibliothek/releases/2026-11-04 /srv/wanderbibliothek/current && sudo systemctl restart wanderbibliothek
```

Las releases antiguas se pueden borrar cuando la copia de seguridad de esa fecha
ya esté fuera del servidor.

Desde la versión de noviembre de 2026, `deploy.sh` también pone al día el vhost
de nginx: si encuentra la regla vieja `location /api/requests/` la cambia por
`location ^~ /api/requests` y recarga nginx. Antes no tocaba el proxy y una
corrección en `deploy/nginx.conf` no llegaba nunca al servidor, que es como
apareció el bucle de redirecciones de `/api/requests`.

## 8. Copias de seguridad y restauración

- **Cada 6 horas** (`wanderbibliothek-backup.timer`, a las 00:20, 06:20, 12:20 y
  18:20; antes era diaria, pero la base ocupa ~2 MB y el RPO baja de 24 h a 6 h),
  con `integrity_check` y rotación de 14 copias.
- **Cada domingo a las 05:10**, `wanderbibliothek-verify.timer` descifra la copia
  más reciente y la abre entera con el mismo código que sirve la web. Si la
  restauración no es posible, la unidad falla y el motivo queda en
  `journalctl -u wanderbibliothek-verify`.
- Con `WANDERBIBLIOTHEK_BACKUP_KEY` las copias se cifran (AES-256-GCM) y el `.db` plano
  se borra. **Guarda esa clave fuera del servidor**: sin ella las copias no
  sirven. Sin clave la copia quedaría en claro con correos y hashes dentro, así
  que `env-check` la trata como **error** y el servicio no arranca (una variable
  **vacía** cuenta como ausente: era la causa de que las copias se guardaran sin
  cifrar). `WANDERBIBLIOTHEK_SKIP_ENV_CHECK=1` sigue existiendo para entornos de
  prueba que asumen la carencia.
- Una copia en el mismo disco que la base no protege de lo que más pasa (el disco
  o el propio servidor se van enteros). `deploy/backup-pull.sh` **trae** las
  copias al portátil, que funciona aunque el portátil esté detrás de un NAT:

  ```bash
  # Una vez: la clave, fuera del servidor y con permisos cerrados.
  ssh wanderbibliothek 'sudo sed -n "s/^WANDERBIBLIOTHEK_BACKUP_KEY=//p" /etc/wanderbibliothek/env' \
    > ~/.config/wanderbibliothek/backup-key
  chmod 600 ~/.config/wanderbibliothek/backup-key

  # Cada día: las unidades de `deploy/backup-pull-user.{service,timer}`.
  install -Dm644 deploy/backup-pull-user.service ~/.config/systemd/user/wanderbibliothek-backup-pull.service
  install -Dm644 deploy/backup-pull-user.timer   ~/.config/systemd/user/wanderbibliothek-backup-pull.timer
  systemctl --user daemon-reload
  systemctl --user enable --now wanderbibliothek-backup-pull.timer
  loginctl enable-linger "$USER"   # corre aunque no tengas la sesión abierta
  ```

  El script trae, rota (30 copias), **descifra la más reciente y comprueba que
  abre como SQLite**: una copia que no se puede restaurar no es una copia.
- `WANDERBIBLIOTHEK_BACKUP_HOOK` permite lo contrario, enviarlas desde el
  servidor (`rsync`, `rclone`, S3); `env-check` avisa si no hay ni gancho ni
  copia externa. En modo imagen, el backup se ejecuta con el digest del
  contenedor activo (y falla si no coincide con `image.env`), sin red y como el
  UID no privilegiado de la app. La web no recibe la clave de copias ni el
  comando del hook: el envoltorio valida la clave en el host y pasa solo un
  indicador no secreto al proceso web. El hook se ejecuta después en el host,
  también como ese UID y con un entorno limpio (ruta, HOME y `BACKUP_FILE`), para
  no filtrar a herramientas externas las claves de la app ni meter herramientas
  de terceros en la imagen. Si el proveedor requiere credenciales, guárdalas en
  la configuración del usuario de la app, fuera de
  `/etc/wanderbibliothek/env`. En modo código, el mismo wrapper ejecuta la
  release de `current`.
- **Ensayo de restauración**: `npm run db:verify` descifra la copia más reciente
  (o la que se le pase), la abre en solo lectura como lo haría la aplicación,
  ejecuta `integrity_check` y `foreign_key_check`, comprueba la versión del
  esquema y cuenta las tablas principales. Sale con error si la copia no se
  puede restaurar, así que sirve para una comprobación periódica:

  ```bash
  WANDERBIBLIOTHEK_BACKUP_KEY="$(cat ~/.config/wanderbibliothek/backup-key)" \
    npm run db:verify -- ~/copias/wanderbibliothek-2026-11-14T03-20-00-000Z.db.enc
  ```

Restauración (ensáyala antes de necesitarla):

```bash
sudo systemctl stop wanderbibliothek
# `--import tsx` se resuelve desde el directorio de trabajo, así que hay que
# situarse en la release: desde `/` el comando falla con
# «Cannot find package 'tsx'» y la restauración no llega a empezar.
cd /srv/wanderbibliothek/current
sudo -u wanderbibliothek WANDERBIBLIOTHEK_BACKUP_KEY="$CLAVE" \
  node --import tsx scripts/decrypt-backup.ts \
  /var/backups/wanderbibliothek/wanderbibliothek-2026-11-04T03-20-00-000Z.db.enc /tmp/restore.db
sudo install -m 600 -o wanderbibliothek -g wanderbibliothek /tmp/restore.db /var/lib/wanderbibliothek/wanderbibliothek.db
sudo rm -f /var/lib/wanderbibliothek/wanderbibliothek.db-wal /var/lib/wanderbibliothek/wanderbibliothek.db-shm
sudo systemctl start wanderbibliothek
curl -fsS https://biblioteca.example.com/api/health
```

Si la copia no estaba cifrada, sáltate `decrypt-backup.ts` y copia el `.db`
directamente. La clave de copias **no** viaja en `/etc/wanderbibliothek/env` si
la guardas fuera del servidor: pásala en la línea de órdenes, como arriba.

### Vigilante (salud, disco, copias y certificado)

`deploy/watchdog.sh` lo ejecuta `wanderbibliothek-watchdog.timer` cada 15
minutos como root y comprueba que `/api/health` responde y dice
`proxy: "trusted"`, que el disco no pasa del 85 %, que la última copia tiene
menos de 12 h y que el certificado no caduca en menos de 14 días. Lo que falla
va al journal; si defines `ERROR_WEBHOOK_URL` en `/etc/wanderbibliothek/env`,
también sale un JSON a ese webhook. Los umbrales se cambian con
`MAX_DISK_PCT`, `MAX_BACKUP_AGE_H` y `MIN_CERT_DAYS`.

Además, con `MAINTENANCE_TOKEN` definido, pide `/api/metrics?format=prometheus`
y vigila lo que la sonda de salud no ve:

| Qué | Variable | Por defecto |
|---|---|---|
| Correos dados por perdidos en 24 h | — | cualquier valor > 0 avisa |
| Correos en estado fallido | `MAX_MAIL_FAILED` | `0` |
| Espera del correo pendiente más antiguo | `MAX_MAIL_WAIT_MIN` | `120` |
| Tamaño del WAL (el checkpoint no completa) | `MAX_WAL_MB` | `512` |
| Proporción de errores de servidor | `MAX_ERROR_PCT` | `5` |
| Peticiones mínimas para calcularla | `MIN_REQUESTS_ERRORS` | `50` |

Un correo que el proveedor acepta y el buzón manda a spam no deja rastro: la
base lo marca como entregado y la persona nunca ve su enlace. Por eso la cola
se vigila aquí y los registros del dominio se comprueban con `npm run
mail:health` (ver la sección de correo).

```bash
sudo systemctl start wanderbibliothek-watchdog.service   # probarlo a mano
sudo journalctl -u wanderbibliothek-watchdog -n 20
```

Cada pasada deja además una línea en
`/var/lib/wanderbibliothek/watchdog.csv` con la hora, el código HTTP, el tiempo
hasta el primer byte, el disco, la memoria, las horas desde la última copia, los
días de certificado y el estado. El journal dice qué pasó en el último cuarto de
hora; el CSV permite mirar la semana (`awk -F, '$8 != "ok"' …`) cuando alguien
cuenta que «ayer iba lento».

El servicio invoca `/usr/local/sbin/wanderbibliothek-watchdog`, no una ruta del
checkout, por lo que su código queda fijado al instalarlo y se actualiza junto
con las unidades.

Con `WATCHDOG_PING_URL` (por ejemplo un *check* de healthchecks.io) cada pasada
hace un `GET` a esa URL y, cuando algo falla, a `<URL>/fail`: el aviso llega por
correo o Telegram sin abrir ningún puerto más en el servidor.

### Disponibilidad desde fuera (`uptime-check.sh`)

El vigilante vive **en** el servidor: si el servidor entero se cae, el vigilante
se cae con él y nadie avisa. `deploy/uptime-check.sh` cierra ese hueco desde
otra máquina (el portátil, un equipo de casa, un contenedor en otro proveedor):

```bash
./deploy/uptime-check.sh --webhook https://…   # una pasada
```

Comprueba `/api/health` y la portada con tiempo límite, guarda el estado en
`~/.local/state/wanderbibliothek/` y solo avisa en los **cambios** (CAÍDO una vez
al empezar el fallo, RECUPERADO al volver) para no llenar el buzón. Los
`deploy/wanderbibliothek-uptime.{service,timer}` lo ejecutan cada cinco minutos
en esa máquina:

```bash
mkdir -p ~/.local/bin ~/.local/state/wanderbibliothek
install -m 755 deploy/uptime-check.sh ~/.local/bin/wanderbibliothek-uptime-check
install -m 644 deploy/wanderbibliothek-uptime.service deploy/wanderbibliothek-uptime.timer ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now wanderbibliothek-uptime.timer
```

## 9. Diagnóstico rápido

| Síntoma | Causa habitual |
|---|---|
| Todo responde 500 y el log dice `[env] ERROR …` | Falta una variable obligatoria del punto 4 |
| El login «funciona» pero al recargar no hay sesión | El sitio se sirve por HTTP: la cookie `__Host-` necesita TLS |
| No llegan correos de verificación | Falta el proveedor (`BREVO_API_KEY` + `MAIL_FROM`, o `MAIL_WEBHOOK_URL`) o el proveedor rechaza; el motivo sale en `journalctl \| grep '\[mail\]'` y los reintentos en el outbox del cron |
| `/admin` y las rutas de moderación dan 403 | La cuenta admin no tiene 2FA activa (o falta `APP_ENCRYPTION_KEY`) |
| 429 para todo el mundo | `TRUST_PROXY` sin activar: todas las IP comparten la cuota `direct` |
| 429 solo en `/api/auth/*` con `limit_req` en el log | El límite de nginx: 10 peticiones/minuto por IP. Sube `rate`/`burst` si hay un CDN delante sin `real_ip` |
| `/api/cron/maintenance` responde 403 al llamarlo desde fuera | Correcto: nginx solo lo deja entrar desde loopback |
| Los mensajes nuevos no aparecen solos | nginx con buffering en `/api/requests/` |
| Al pedir un libro, la app dice «el servidor responde con una redirección» y la web «No hay conexión con el servidor» | El vhost todavía tiene `location /api/requests/ {` (con barra). nginx manda `/api/requests` a `/api/requests/`, Next lo devuelve a `/api/requests` y el 301/308 se muerde la cola. Se ve con `curl -sI https://tu-dominio/api/requests \| grep -i location`. Arreglo (una línea, sin tocar el resto del fichero, que es de certbot): `sudo sed -i 's\|location /api/requests/ {\|location ^~ /api/requests {\|' /etc/nginx/sites-available/wanderbibliothek && sudo nginx -t && sudo systemctl reload nginx`. `deploy.sh` lo corrige solo en el siguiente despliegue |
| Una portada nueva tarda en verse | Caché del proxy: la URL correcta lleva `?v=…` (la genera la app al subir). Si `curl -sI` de la imagen devuelve `X-Cache-Status: HIT` con la imagen vieja, se subió sin versión: vacía `/var/cache/nginx/wb_images` |
| Subir una portada responde **413** | `client_max_body_size` de nginx (128 KB globales, pensados para JSON). La ruta `/api/cover/` necesita su propio `location` con 8 MB; el registro del proxy lo dice: `error.log` → `client intended to send too large body`. Sin eso la imagen ni llega a la aplicación |
| El disco crece y la base no baja | Normal: SQLite no compacta al borrar; el mantenimiento hace `PRAGMA optimize` y `wal_checkpoint(TRUNCATE)` |
| No hay copias en `/var/backups/wanderbibliothek` | Mira `journalctl -u wanderbibliothek-backup`; si el log habla de `tsx`, la release se instaló sin dependencias de producción o falta el `WorkingDirectory` |
| `Failed to start server … EADDRINUSE` | Hay otro `next start` o un `.next` de otra release |

### Informe de accesos y ataques

`deploy/informe-accesos.sh` compone el informe del día desde el portátil: entra
por SSH, lee el journal de `ssh`, los access logs de nginx (incluidos los
rotados), `/var/log/fail2ban.log` y la base de datos, y saca el resumen de
intentos fallidos, usuarios probados, baneos, sondas bloqueadas con `444`,
respuestas `5xx`, logins fallidos en `/api/auth/login` y estado del servicio. Es
solo lectura: no escribe nada ni dispara límites de nginx.

```bash
./deploy/informe-accesos.sh            # hoy (día del servidor)
./deploy/informe-accesos.sh --ayer     # el día anterior
./deploy/informe-accesos.sh --dias 7   # hace siete días
npm run informe:accesos -- --json      # una línea JSON, para cron o webhook
```

Dos detalles que conviene saber:

- **Los logrotate no caen a medianoche exacta**: el `access.log.1` puede tener
  la primera hora del día. El script lee los ficheros rotados y filtra por la
  fecha de la línea, así que el total del día está completo (mirar solo el
  `access.log` corriente se deja esas peticiones fuera).
- **Las IPs con acceso SSH correcto se excluyen solas** de la lista de
  atacantes (incluida la del portátil que lanza el informe). Si hace falta
  añadir alguna más: `WB_EXCLUIR=1.2.3.4,5.6.7.8 ./deploy/informe-accesos.sh`.

Sale con código 1 cuando hay algo que mirar (5xx, `Accepted password` en SSH,
`/api/health` distinto de 200 o fail2ban sin baneos habiendo fallos), así que
sirve tal cual en un cron con `ERROR_WEBHOOK_URL`.

La línea «Del bot de Mastodon» cuenta las páginas abiertas con `?ref=mastodon`,
la marca que lleva el enlace de cada aviso (ver `ANNOUNCE_REF` en
`src/lib/mastodon.ts`). Existe porque las apps del fediverso no siempre mandan
`Referer`: sin ella, una visita de Mastodon es indistinguible de una que llega
sin origen. Es un recuento de aperturas, no de personas.

El bloque `── MASTODON ──` cierra el informe con lo que no está en los logs: las
visitas que sí llegan con `Referer` de una instancia o de una app del fediverso
(sirve para los avisos anteriores a la marca), el reparto por origen y el estado
de la cuenta del bot (seguidores y respuesta a los últimos veinte avisos, leída
de la API con el token de `/etc/wanderbibliothek/env`; el token solo tiene
`read:accounts`, así que los estados se consultan sin él). Si no hay red o
token, esas líneas salen con «-» y el informe sigue siendo válido. Las IPs de la
lista de exclusión (las que entran por SSH, o sea, quien lanza el informe) no
cuentan como visitas; para dejar fuera tu móvil, añádelo con `WB_EXCLUIR`.

## Continuidad y relevo

Una instancia no debería depender de una sola persona. Antes de abrir el registro:

- Crea al menos **dos cuentas de administración** (`npm run admin:create`). La segunda puede quedar inactiva, pero debe existir y tener el segundo factor configurado.
- Para moderar sin administrar, crea una cuenta de moderación (`npm run moderator:create`): revisa denuncias y oculta contenido, pero no suspende cuentas.
- Guarda **fuera del servidor** una copia cifrada de la base y de `APP_ENCRYPTION_KEY`; sin la clave, las copias no se pueden restaurar.
- Documenta quién controla el dominio, el DNS, el proveedor del servidor, el correo y el repositorio.
- Deja escrito el procedimiento de relevo: qué credenciales hay que transferir, dónde están las copias y cómo se comprueba una restauración (`npm run db:verify`).
- Revisa una vez al año que la segunda persona puede entrar, restaurar una copia y publicar un cambio.

Las normas de convivencia, la moderación y las apelaciones se publican en `/normas`; el documento de referencia está en [`GOVERNANCE.md`](../GOVERNANCE.md).

## 10. Límites conocidos

- **Una sola instancia.** SQLite tiene un único escritor, así que varias
  réplicas exigen PostgreSQL. El canal en vivo no es el problema: el bus en
  memoria solo ahorra latencia y la fuente de verdad se consulta en la base, de
  modo que dos procesos coinciden con hasta 15 s de retraso.
- **Cada actualización reinicia el proceso.** No hay azul/verde: el servicio se
  para, arranca la imagen o release nueva y se comprueba `/api/health`; si falla,
  se vuelve a la anterior. Son unos segundos sin servicio, y no hay alta
  disponibilidad: dos réplicas exigen PostgreSQL.
- **Los scripts de operación necesitan `tsx`**, que está en `dependencies` a
  propósito (no es una devDependency): así funcionan también con
  `npm ci --omit=dev` y dentro de la imagen.
- **La base no se migra hacia atrás**: ante un despliegue que cambie el esquema,
  la copia previa es la vuelta atrás.
- **Los registros van a journald** (`journalctl -u wanderbibliothek`) en host, y a
  `docker compose logs` en contenedor. Con `ERROR_WEBHOOK_URL` se reenvían además
  los errores a un servicio externo.
- **La copia fuera del servidor es un `rsync`/`scp` a una máquina tuya**
  (`deploy/backup-pull.sh`). Una copia en un cubo (S3, Backblaze B2, R2) exige
  una cuenta y sus claves; cuando las haya, el sitio donde encaja es
  `WANDERBIBLIOTHEK_BACKUP_HOOK` (recibe la ruta en `$BACKUP_FILE`, así que vale
  `rclone copy "$BACKUP_FILE" remoto:`) o un Litestream aparte que replique el
  WAL. Ninguna de las dos está activada por defecto: sin credenciales no se
  puede probar, y una copia que nunca se ha restaurado no es una copia.
- **`ERROR_WEBHOOK_URL` y `WATCHDOG_PING_URL` están vacías**: el código las usa si
  existen, pero el destino lo elige quien opera (Slack, healthchecks.io, un
  correo). No hay valor por defecto a propósito.

## 11. Docker

Alternativa al servicio systemd, mismo comportamiento. `Dockerfile` es
multi-etapa (el runtime solo lleva dependencias de producción) y
`docker-compose.yml` monta dos volúmenes: datos y copias.

```bash
cp deploy/env.example .env      # NEXT_PUBLIC_SITE_URL=https://tu-dominio…
docker compose up -d --build
docker compose ps               # debe estar «healthy»
curl -fsS http://127.0.0.1:3000/api/health
```

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` (captcha) se incrusta en el bundle del cliente:
en Docker hay que pasarla como **build arg**, no basta con el `.env` del
contenedor.

```bash
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAA… docker compose build
docker compose up -d
```

En el `.env` cambia solo las rutas de datos:

```
WANDERBIBLIOTHEK_DB=/data/wanderbibliothek.db
WANDERBIBLIOTHEK_BACKUP_DIR=/backups
```

(el `docker-compose.yml` ya las fija, así que no hace falta tocar nada si
partes de `deploy/env.example`).

La aplicación escucha en `127.0.0.1:3000` del host: pon delante el mismo nginx de
`deploy/nginx.conf` (el `proxy_pass` ya apunta a `127.0.0.1:3000`). Para probar en
local basta `http://localhost:3000`: el navegador trata localhost como contexto
seguro y acepta la cookie `__Host-`.

Tareas y administración dentro del contenedor:

```bash
# Administrador (solo la primera vez)
docker compose exec -T app node --import tsx scripts/create-admin.ts admin@tu-dominio 'contraseña-larga'

# Verificar un correo a mano
docker compose exec -T app node --import tsx scripts/verify-user.ts alguien@ejemplo.com

# Copia de seguridad
# (el volumen /backups es lo que conviene llevarse fuera)
```

Programa desde el **host** (systemd timer o cron), no dentro del contenedor:

```cron
*/15 * * * *  curl -fsS -X POST -H "Authorization: Bearer $MAINTENANCE_TOKEN" http://127.0.0.1:3000/api/cron/maintenance
20 3 * * *    cd /srv/wanderbibliothek && docker compose exec -T app node --import tsx scripts/backup.ts
```

Notas:

- `docker compose exec` necesita el contenedor en marcha; si el servicio está
  caído, arranca primero `docker compose start app`.
- El `HEALTHCHECK` (y el de compose) consulta `/api/health`: si el entorno está
  incompleto, el contenedor queda **unhealthy** y `docker compose logs` muestra
  las líneas `[env] ERROR …`.
- Las releases se cambian con `docker compose pull` + `up -d --no-build` si la
  imagen está fijada por digest, o con `docker compose build` + `up -d` si se
  construye en el servidor. El volumen de datos sobrevive en los dos casos.
- El build de la imagen se valida en CI (job `imagen`), no hace falta compilarla
  en el servidor.

## Verificar una release (software y contenido)

Una instancia puede decir «ejecuto este código» de tres formas, de menos a más
prueba. Las dos primeras ya están implementadas y no dependen de confiar en
quien administra el servidor; la tercera es infraestructura y se explica al
final para que nadie crea que está cubierta.

### 1. Qué código dice estar sirviendo

`GET /api/version` es público y devuelve, sin datos de nadie:

```json
{
  "commit": "4e32f58…",
  "commitUrl": "https://github.com/gallardoalba/WB/commit/4e32f58…",
  "image": "sha256:…",
  "builtAt": "2026-11-15T10:20:30.000Z",
  "repository": "https://github.com/gallardoalba/WB",
  "sourceUrl": "https://github.com/gallardoalba/WB/tree/4e32f58…"
}
```

Si la instalación no sabe qué commit ejecuta, los campos valen `null`: no se
inventa nada. El pie de página enseña el mismo commit cuando existe.

- **systemd desde código:** `deploy/deploy.sh` escribe `.build-info.json` en
  cada release con el commit del clon y la hora del build. Es lo que hay en este
  modo, pero no hay digest que publicar: para eso, usa el
  [despliegue por imagen firmada](#despliegue-por-imagen-firmada).
- **Docker:** el commit y la hora entran como *build args* y quedan dentro de la
  imagen (`docker inspect` los muestra en `org.opencontainers.image.revision`).
  El digest se publica si despliegas con `WANDERBIBLIOTHEK_IMAGE` fijada por
  digest, porque es la referencia la que lo contiene.

### 2. Que la imagen salió de este repositorio

Cada etiqueta `v*` ejecuta `.github/workflows/release.yml`, que:

- construye y publica en GHCR **por digest**;
- adjunta provenance SLSA (`mode=max`) y un SBOM de la imagen;
- firma con cosign en modo keyless, con la identidad del propio workflow;
- publica una release con `sbom.cdx.json`, `SHA256SUMS`, `image-digest.txt` e
  `image-reference.txt`.

Para desplegar una release verificada, fija el digest en `.env` y no dejes que
Compose construya:

```bash
# .env
WANDERBIBLIOTHEK_IMAGE=ghcr.io/gallardoalba/wb@sha256:…

./deploy/verify-release.sh      # lee WANDERBIBLIOTHEK_IMAGE
docker compose pull
docker compose up -d --no-build
```

`deploy/verify-release.sh` exige `cosign` y comprueba la firma contra este
repositorio y este workflow; si está `slsa-verifier`, comprueba también la
provenance. Rechaza una referencia sin digest: una etiqueta se puede mover y la
firma no la seguiría.

```bash
cosign verify ghcr.io/gallardoalba/wb@<digest> \
  --certificate-identity-regexp '^https://github\.com/gallardoalba/WB/\.github/workflows/release\.yml@refs/tags/.*$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

slsa-verifier verify-image ghcr.io/gallardoalba/wb@<digest> \
  --source-uri github.com/gallardoalba/WB
```
La imagen no promete reproducibilidad bit a bit: Next, npm y las marcas de
tiempo del sistema de archivos hacen que dos builds puedan diferir aunque el
código sea el mismo. Lo que ata la imagen al código es la provenance SLSA: dice
qué workflow, qué commit y qué pasos la produjeron, y la firma keyless dice que
ese workflow es el de este repositorio. Para auditar el contenido, reconstruye
desde ese commit con `docker build --build-arg APP_COMMIT_SHA=<sha>` y compara el
comportamiento y los ficheros que te interesen; si necesitas igualdad byte a
byte, ese es el siguiente paso (Nix o `rebuilderd`), no algo que hoy se afirme.

### 3. Que el contenido público no se reescribe en silencio

`/api/transparency` publica **instantáneas firmadas del catálogo público**. Cada
una contiene:

- `merkleRoot`: raíz de Merkle de todas las obras públicas;
- `payloadHash`: SHA-256 del NDJSON exacto que se puede descargar;
- `previousRoot`: raíz de la instantánea anterior (cadena);
- `signature` y `publicKey`: firma Ed25519 en base64 y la clave con la que se
  firmó (o `null` si la instancia no tiene clave).

El contenido se descarga en `/api/transparency/export` (`application/x-ndjson`,
una obra por línea) y **solo lleva lo que ya es público**: título, autoría,
edición, categoría e idioma, número de ejemplares y ciudades. Nunca quién tiene
cada ejemplar, ni correos, ni identificadores de personas. Por eso puede servirse
sin sesión sin recortar nada.

El cron de mantenimiento crea una instantánea al día. Para firmarlas, genera una
clave Ed25519 (PKCS#8 en base64, que es lo que acepta la variable) y ponla en el
entorno del servicio:

```bash
node -e "const{generateKeyPairSync}=require('crypto');process.stdout.write(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'))" > /tmp/wb-transparency.key
# TRANSPARENCY_SIGNING_KEY=$(cat /tmp/wb-transparency.key)   → edita /etc/wanderbibliothek/env
sudo systemctl restart wanderbibliothek
rm /tmp/wb-transparency.key
npm run transparency:snapshot       # o espera al cron
```

Verificar desde fuera, sin la base ni el código del servidor:

```bash
npm run transparency:verify -- --url https://tu-dominio
```

El verificador descarga la instantánea y su NDJSON, recalcula hash y raíz,
comprueba la firma y que la cadena de raíces no tenga eslabones rotos. Si eres un
testigo externo, guarda la huella de la clave y la raíz que viste y pásalas con
`--snapshot <id> --key-fingerprint <sha256> --pin <raíz>`: si la instancia
reescribe esa instantánea o empieza a firmar con otra clave, la comprobación
falla. Sin
firma, el verificador sale con error: una instantánea sin clave sirve para
comparar contenido, no como prueba criptográfica.

Qué garantiza: que un cambio en lo publicado deja rastro y que una instantánea
pasada no se puede sustituir por otra sin romper la firma o la cadena. Qué no
garantiza: que el proceso que responde sea exactamente esa imagen. Eso solo lo
da la attestation por hardware (siguiente apartado).

### 4. Prueba criptográfica del proceso (no implementada)

Si el modelo de amenaza incluye a quien administra el servidor o al proveedor de
la máquina, firmar imágenes no basta: hay que medir el arranque y el sistema de
ficheros, y publicar una prueba que se pueda verificar fuera.

- **TPM 2.0 + arranque medido + IMA/dm-verity**, con un servidor de attestation
  como [Keylime](https://keylime.dev/). El host publica un *quote* firmado por el
  TPM con las PCR; el verificador compara contra el estado esperado. Cubre
  kernel, initramfs e integridad de ficheros, no la configuración de la base.
- **Computación confidencial**: AMD SEV-SNP o Intel TDX (Azure/GCP Confidential
  VM) o AWS Nitro Enclaves. Proyectos como
  [Constellation](https://constellation.edgeless.systems/) montan Kubernetes
  verificable con `constellation verify`. Aquí la confianza se traslada al
  fabricante de la CPU, no desaparece.

Ninguna de las dos está integrada en este repositorio y no se pueden activar
desde la aplicación: dependen del host, del hipervisor y, en la práctica, de un
segundo canal para publicar el *quote*. Mientras no existan, la transparencia de
Wanderbibliothek es **detectable, no imposible**: código abierto, imagen firmada,
commit publicado e instantáneas firmadas del contenido.

## Despliegue por imagen firmada

El despliegue de las secciones anteriores compila desde el código y ejecuta
`next start` directamente. Funciona, pero entonces **no hay artefacto OCI** y
`/api/version` publica `image: null`: el commit es autoinformado y no existe una
firma que ligue los ficheros que corren con la release de GitHub.

Este apartado cambia solo el servicio web a la imagen firmada de GHCR. Los
datos siguen en el host, las copias y los timers no cambian, y nginx tampoco.
La diferencia es que `/api/version` pasa a publicar el digest, y cualquiera
puede comprobarlo con `cosign verify` y `slsa-verifier`.

### Requisitos

```bash
sudo apt-get update && sudo apt-get install -y docker.io
sudo systemctl enable --now docker

# cosign (binario oficial; no hace falta el resto de Sigstore)
curl -fsSL https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64 \
  -o /tmp/cosign && sudo install -m 755 /tmp/cosign /usr/local/bin/cosign
```

La imagen es pública: no hace falta `docker login` para descargarla.

### Instalación inicial de la unidad

```bash
# 1. Envoltorio que arranca el contenedor con los montajes del host.
sudo install -m 755 deploy/run-container.sh /usr/local/sbin/wanderbibliothek-container
sudo install -Dm644 deploy/backup-key.sh /usr/local/lib/wanderbibliothek/backup-key.sh

# 2. Unidad de systemd (sustituye a la del servicio de código).
sudo cp -a /etc/systemd/system/wanderbibliothek.service \
  /etc/systemd/system/wanderbibliothek.service.source   # vuelta atrás
sudo install -m 644 deploy/wanderbibliothek-image.service \
  /etc/systemd/system/wanderbibliothek.service
sudo systemctl daemon-reload

# 3. Caché de Next escribible por el usuario del host.
sudo install -d -m 700 -o wanderbibliothek -g wanderbibliothek \
  /var/lib/wanderbibliothek/next-cache

# 4. El comando de despliegue, disponible sin depender del clon.
sudo install -m 755 deploy/deploy-image.sh /usr/local/sbin/wanderbibliothek-deploy-image

# 5. Primera imagen, verificada y fijada por digest.
sudo deploy/deploy-image.sh --ref 1.0.1
```

`deploy-image.sh` descarga la etiqueta, resuelve el digest, **verifica la firma
keyless** contra este repositorio, escribe `/etc/wanderbibliothek/image.env`
(600 root) y reinicia el servicio. Si `/api/health` no responde, restaura la
imagen anterior y vuelve a arrancar.

Comprobar:

```bash
curl -fsS http://127.0.0.1:3000/api/version | python3 -m json.tool
# "commit": "e8d969c…", "image": "sha256:844acd…"

docker inspect --format '{{.Config.Labels}}' \
  "$(sed -n 's/^WANDERBIBLIOTHEK_IMAGE=//p' /etc/wanderbibliothek/image.env)"
```

### Desacoplar las operaciones de `current`

En una instalación ya existente, primero publica y despliega `v1.0.3` o una
versión posterior: la imagen debe incluir el marcador que permite al wrapper
identificar la copia creada. Después, desde el checkout, ejecuta:

```bash
sudo wanderbibliothek-deploy-image --ref 1.0.3
```

Y después:

```bash
sudo deploy/install-image-operations.sh
```

El instalador solo trabaja si detecta que systemd ya ejecuta el modo imagen.
Guarda copias fechadas de las unidades, el hardening y el vhost de nginx;
reemplaza las rutas de assets de `current` por el proxy al contenedor, instala
backup/watchdog en `/usr/local/sbin`, reinicia el servicio, comprueba health y
habilita los temporizadores. Si nginx no valida, restaura el vhost; si falla el
reinicio o la comprobación de salud, restaura el vhost, las unidades y los
wrappers anteriores e intenta reiniciar el servicio. No borra el checkout ni
desactiva `deploy.sh`.

Prueba explícita de la copia en el modo imagen:

```bash
sudo systemctl start wanderbibliothek-backup.service
sudo journalctl -u wanderbibliothek-backup.service -n 40 --no-pager
```

La copia y las portadas se generan con el código de la imagen en ejecución. La
base cifrada, los ficheros de backup y el watchdog siguen en el host; la clave
no se publica ni se copia al almacenamiento externo junto con los datos.

### Actualizar y volver atrás

```bash
sudo deploy/deploy-image.sh --ref 1.0.2     # nueva release firmada
sudo deploy/deploy-image.sh --rollback      # vuelve a la anterior

# o, si se instaló en /usr/local/sbin:
sudo wanderbibliothek-deploy-image --ref 1.0.2
```

El rollback real de la aplicación es cambiar el digest. Tras instalar el
desacople, `current` ya no es una dependencia de los servicios web, backup,
watchdog, nginx ni sus unidades; puede conservarse para las herramientas
administrativas y como alternativa explícita de despliegue por código.

### Lo que no cambia

- **Base y portadas**: siguen en `/var/lib/wanderbibliothek`, montadas en
  `/data`. El contenedor corre con el UID/GID del usuario `wanderbibliothek`
  del host para que los ficheros conserven el dueño.
- **Copias**: el contenedor de una sola ejecución usa el mismo digest que el
  contenedor web activo; los datos y la clave permanecen bajo control del host.
- **nginx y TLS**: nginx mantiene el TLS y proxyfica HTML y assets a
  `127.0.0.1:3000`. Las tareas de mantenimiento y watchdog siguen siendo
  servicios de host.

### Volver al despliegue por código

```bash
sudo cp -a /etc/systemd/system/wanderbibliothek.service.source \
  /etc/systemd/system/wanderbibliothek.service
sudo install -m 644 deploy/wanderbibliothek-hardening.conf \
  /etc/systemd/system/wanderbibliothek.service.d/hardening.conf
sudo systemctl daemon-reload
sudo systemctl restart wanderbibliothek
```

No mezcles los dos modos: si vuelves a `deploy.sh` con la unidad de imagen
instalada, el servicio seguirá arrancando el contenedor. Restaura la unidad
antes de desplegar desde código.

## 12. Privacidad y retención de datos

Lo que la base guarda y cuánto vive, para que la política de privacidad que
publiques diga la verdad (art. 5.1.e y 13 del RGPD/DSGVO):

| Dato | Dónde | Se conserva |
|---|---|---|
| Nombre, correo, ciudad, biografía, idioma | `users` | Hasta que la persona borra la cuenta |
| Contraseña | `users.password_hash` (scrypt) | Igual; nunca en claro |
| Sesiones | `sessions` | 14 días deslizantes, 30 como máximo |
| Enlaces de confirmación y restablecimiento | `account_tokens` | 24 h / 1 h; un solo uso |
| Correos enviados (cuerpo con enlaces) | `mail_outbox` | 7 días los ya entregados |
| IP del visitante (cuotas y anti-fuerza bruta) | `throttle`, `auth_attempts` | Pseudónimo diario, nunca la dirección; ≤ 1 día |
| Avisos de la plataforma | `notifications` | 90 días si se leyeron, 180 cualquiera |
| Actividad pública (muro) | `events` | 180 días |
| Auditoría de moderación | `admin_audit` | `AUDIT_RETENTION_DAYS` (0 = siempre) |
| Mensajes | `messages` | Solo el sobre cifrado y los metadatos; el texto lo descifran los navegadores |

Borrado de cuenta: se anonimiza la fila del usuario, se borran sesiones,
avisos, listas, clubes propios, bloqueos, tokens, marcas de lectura, notas
personales de sus ejemplares y **las claves de dispositivo** (`user_keys` y
`public_key_history`, que el `ON DELETE CASCADE` no alcanza porque la fila de
`users` no se borra); las **conversaciones directas se eliminan enteras**, para
las dos partes, y los mensajes de intercambio y valoraciones se conservan con el
autor ya anonimizado porque son parte del historial de otras personas. La base
usa `secure_delete`, así que el contenido borrado no queda en las páginas
libres del fichero.

Salvaguardas que ya trae la aplicación: las cuotas guardan un **pseudónimo
diario** de la IP (HMAC con una sal derivada de `APP_ENCRYPTION_KEY`, no la
dirección), las **portadas se descargan en el servidor** y se cachean en
`WANDERBIBLIOTHEK_COVER_CACHE` (el navegador no contacta con Open Library), el
catálogo se ve sin sesión pero **lo que se indexa son las fichas de obra**
(`/werk/<id>`, sin el nombre de quien ofrece), `/descubrir`, `/libro`, `/u` y el
resto de vistas con datos personales están en el `disallow` de `robots.txt`, y
el registro exige **declarar 16 años o más**.

Quedan tres decisiones que son tuyas:

1. **Datos del responsable.** `/privacidad` y `/aviso-legal` ya existen, en
   castellano y alemán, con lo que el código hace de verdad. Se completan con
   `LEGAL_CONTROLLER`, `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL` y, si procede,
   `LEGAL_VAT_ID`; sin ellas las páginas muestran un aviso visible de que están
   incompletas y el arranque lo recuerda en el log. El texto sigue siendo un
   borrador técnico: revísalo con quien asuma la responsabilidad legal.
2. **Copias de seguridad.** Cada copia contiene datos que quizá ya se borraron
   de la base: se conservan las `WANDERBIBLIOTHEK_BACKUP_KEEP` más recientes
   (14 por defecto, una cada seis horas) y la copia externa guarda 30. La
   política lo declara; no restaures una copia para uso normal.
3. **Terceros que ven al visitante.** Tu proveedor de correo (recibe el correo y
   el texto del aviso, nunca el contenido de los mensajes cifrados), Cloudflare
   si activas Turnstile, y el proveedor de alojamiento. Open Library/Internet
   Archive ya solo ve la IP del servidor al pedir una portada.

Lo que la plataforma **no** hace: ni analítica, ni fuentes, ni cookies de
publicidad (solo la cookie de sesión, que es necesaria y no requiere banner de
consentimiento), el *service worker* no cachea respuestas y la clave privada de
cifrado nunca sale del navegador.
## 13. Lista de comprobación legal antes de abrir

La aplicación publica `/privacidad` y `/aviso-legal` con lo que el código hace
de verdad, pero hay decisiones que **solo puede tomar quien opera el servicio**.
`npm run smoke` falla si las páginas legales quedan incompletas, así que esta
lista no se puede olvidar en silencio.

- [ ] Definidos en `/etc/wanderbibliothek/env`: `LEGAL_CONTROLLER`,
      `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL` y, si existen, `LEGAL_REGISTER`,
      `LEGAL_VAT_ID` y `LEGAL_PHONE`.

      Para no editarlo a mano:

      ```bash
      sudo -E npm --prefix /srv/wanderbibliothek/current run legal:env -- \
        --name "Nombre o razón social" \
        --address "Calle 1, 00000 Ciudad, Alemania" \
        --email privacidad@tudominio.example \
        --register "Vereinsregister Amtsgericht …, VR 12345" \
        --vat DE000000000 --phone "+49 …" \
        --write /etc/wanderbibliothek/env
      sudo systemctl restart wanderbibliothek
      ```

      El comando solo sustituye las líneas `LEGAL_*`; el resto del fichero
      (secretos, rutas) queda intacto. Sin `--write` imprime el bloque para
      pegarlo tú.
- [ ] Forma jurídica decidida (particular, asociación, GmbH…). De ella depende
      qué campos del Impressum son obligatorios: una asociación necesita el
      registro y su número; una GmbH, además, el representante.
- [ ] Comprobado si hay obligación de designar delegado de protección de datos
      (art. 37 RGPD). Para este tamaño de plataforma no suele haberla, pero es
      una decisión documentada, no una suposición.
- [ ] Proveedor de correo identificado (nombre y país) y **contrato de encargo
      del tratamiento** firmado; si está fuera del EEE, con cláusulas
      contractuales tipo.
- [ ] Proveedor de alojamiento identificado y con contrato de encargo.
- [ ] Autoridad de control competente por el domicilio del responsable
      (Baden-Württemberg: LfDI).
- [x] Ensayada una restauración real desde copia y confirmado el plazo de 14
      días que declara la política. **Hecho el 9-nov-2026** con la copia de las
      18:03: descifrada a un fichero temporal, `PRAGMA integrity_check` → `ok`,
      `user_version = 48`, `books_fts` responde a `MATCH 'democ*'` y el secreto
      TOTP de una cuenta se descifra con `APP_ENCRYPTION_KEY` (32 caracteres).
      Repetirlo cada vez que cambie el formato de copia o la clave.
- [ ] Texto revisado por quien asuma la responsabilidad legal: lo que hay es un
      borrador técnico exacto, no un dictamen jurídico.

## Rotar la clave de cifrado

`APP_ENCRYPTION_KEY` protege el secreto TOTP de cada cuenta (los campos de envío
que quedan en la base son históricos: el flujo se retiró el 7-nov). Los valores
guardan dentro el id de la clave con la que se cifraron, así que se puede cambiar
sin perder nada:

```bash
# 1. La nueva clave como activa; la anterior, solo para leer.
export APP_ENCRYPTION_KEY=<nueva-32-bytes>
export APP_ENCRYPTION_OLD_KEYS=<anterior>
npm run rotate:secrets -- --dry-run   # informe, no escribe

# 2. Rotación real: vuelve a cifrar y comprueba que lo escrito se lee.
npm run rotate:secrets

# 3. Cuando diga «0 de 0 valores rotados», retira APP_ENCRYPTION_OLD_KEYS
#    y reinicia el servicio.
```

Si el informe lista valores que no se pueden descifrar, **no retires la clave
antigua**: significa que falta otra anterior en `APP_ENCRYPTION_OLD_KEYS`.

El mismo comando cifra los secretos que hayan quedado **en claro** (bases de
desarrollo restauradas en el servidor). En producción un valor sin cifrar ya no
se lee: `decryptSecret` falla a propósito, así que el aviso llega antes de que
alguien use una cuenta con el TOTP en claro. Ejecuta el `--dry-run` después de
una restauración y, si aparece alguno, la rotación sin `--dry-run`.

## Sustituir una web que ya vive en el servidor

Este apartado es para un host que **ya sirve otra web** (por ejemplo un
WordPress con nginx o Apache) y se quiere poner Wanderbibliothek en su lugar sin
quedarse sin nada. La regla es no tocar lo que funciona hasta que lo nuevo
responda por HTTPS en un nombre propio.

### 1. Inventario antes de instalar

```bash
ss -ltnp | grep -E ':(80|443|3000)\b'          # quién ocupa los puertos
systemctl list-units --type=service --state=running --no-pager | head -30
ls -l /etc/nginx/sites-enabled/                 # nginx
ls -l /etc/apache2/sites-enabled/ 2>/dev/null   # Apache, si lo hubiera
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null
df -h / ; free -h ; nproc                       # disco, RAM, núcleos
```

Apunta el dominio actual, su `root`/`proxy_pass` y dónde vive su base de datos:
eso es lo que hay que copiar en el paso 2.

### 2. Copia de la web actual (antes de tocar nada)

```bash
sudo tar -C /etc -czf /root/backup-etc-$(date +%F).tar.gz nginx apache2 2>/dev/null
# WordPress de ejemplo: ficheros, base y configuración
sudo tar -C /var/www -czf /root/backup-www-$(date +%F).tar.gz .
mysqldump --single-transaction -u root -p --all-databases | gzip > /root/backup-db-$(date +%F).sql.gz
# Docker: volúmenes y compose del proyecto en uso
docker run --rm -v <volumen>:/v -v /root:/backup alpine tar -czf /backup/docker-<volumen>.tar.gz -C /v .
```

Sin esta copia no hay vuelta atrás: la web vieja no se «desinstala», se apaga.

### 3. Instalar Wanderbibliothek en paralelo

Sigue los apartados 2 a 5 de esta guía tal cual. No hay conflicto con la web
actual: la aplicación escucha en `127.0.0.1:3000` y solo la publica su propio
`server_name`.

Para probar sin tocar el dominio, publica primero en un subdominio
(`wander.tu-dominio.de`): crea el registro A con antelación y pide el
certificado solo para él.

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/wanderbibliothek
sudo sed -i 's/biblioteca.example.com/wander.tu-dominio.de/g' /etc/nginx/sites-available/wanderbibliothek
sudo ln -s /etc/nginx/sites-available/wanderbibliothek /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d wander.tu-dominio.de
```

En `/etc/wanderbibliothek/env`, `NEXT_PUBLIC_SITE_URL` tiene que ser **exactamente**
ese nombre con `https://`, o la cookie `__Host-` no se guarda y el acceso entra
en bucle.

### 4. Cambiar el dominio

Con el sitio nuevo ya respondiendo en el subdominio:

```bash
# 1) El vhost nuevo pasa a servir el dominio final (y el www, si lo usas).
sudo sed -i 's/wander.tu-dominio.de/tu-dominio.de www.tu-dominio.de/' \
  /etc/nginx/sites-available/wanderbibliothek
sudo sed -i 's|^NEXT_PUBLIC_SITE_URL=.*|NEXT_PUBLIC_SITE_URL=https://tu-dominio.de|' \
  /etc/wanderbibliothek/env

# 2) El vhost de la web vieja deja de escuchar ese nombre: se desactiva, no se borra.
sudo unlink /etc/nginx/sites-enabled/<sitio-antiguo>
sudo systemctl stop <servicio-antiguo>        # php8.x-fpm, apache2, el contenedor…

# 3) Certificado del dominio final y recarga.
sudo certbot --nginx -d tu-dominio.de -d www.tu-dominio.de
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl restart wanderbibliothek
```

Si el dominio apuntaba a **otra IP**, baja el TTL del registro A un día antes y
cámbialo; el certificado no se puede pedir hasta que el DNS resuelva al servidor
nuevo (`dig +short tu-dominio.de`).

`NEXT_PUBLIC_SITE_URL` se lee en cada arranque (sitemap, `robots.txt`, canonical
y avisos del comprobador de entorno), así que basta con reiniciar el servicio:
no hace falta reconstruir la release.

### 5. Verificación y vuelta atrás

```bash
curl -fsS https://tu-dominio.de/api/health
BASE_URL=https://tu-dominio.de npm --prefix /srv/wanderbibliothek/current run smoke
systemctl --no-pager status wanderbibliothek | head -12
systemctl list-timers 'wanderbibliothek-*' --no-pager
sudo journalctl -u wanderbibliothek -n 40 --no-pager | grep -F '[env]'
```

Si algo falla, la vuelta atrás son tres órdenes: reactivar el vínculo del sitio
antiguo (`ln -s`), arrancar su servicio y recargar nginx. Los ficheros de la web
vieja siguen en su sitio: **no borres nada de ella hasta que el sitio nuevo
lleve una semana en pie** con copias funcionando.

### 6. Que el dominio antiguo no muera (301)

Si el dominio de la web anterior va a dejar de tener contenido, es mejor que
redirija al nuevo en vez de dar error: los enlaces guardados y los buscadores
siguen funcionando.

```nginx
# /etc/nginx/sites-available/<dominio-antiguo>-redirect
server {
    listen 80;
    listen [::]:80;
    server_name <dominio-antiguo> www.<dominio-antiguo>;
    return 301 https://<dominio-nuevo>$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name <dominio-antiguo> www.<dominio-antiguo>;
    ssl_certificate     /etc/letsencrypt/live/<dominio-antiguo>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<dominio-antiguo>/privkey.pem;
    return 301 https://<dominio-nuevo>$request_uri;
}
```

Detalle que se olvida: **la redirección solo sirve si el certificado del dominio
antiguo está vigente**. Con el TLS caducado el navegador muestra el aviso y
nunca llega a leer el `301`. Comprueba la renovación antes
(`sudo certbot renew --dry-run`, `systemctl list-timers 'certbot*'`) y, si el
dominio se queda sin contenido, deja ese vhost como única cosa que sirve.

### 7. Lo que no puede faltar antes de abrirlo al público

- `LEGAL_CONTROLLER`, `LEGAL_ADDRESS` y `LEGAL_CONTACT_EMAIL`: sin ellos el
  Impressum y la política de privacidad salen incompletos (obligatorio en
  Alemania). Ver el apartado 13.
- `BREVO_API_KEY` y `MAIL_FROM` (o un `MAIL_WEBHOOK_URL`) con un proveedor real
  y el dominio autenticado: sin correo no se puede confirmar la cuenta ni
  restablecer la contraseña.
- Cuenta de administración creada y **con 2FA activo**; después, borrar
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` del entorno.
- Copias probadas: ejecutar `wanderbibliothek-backup.service` a mano una vez y
  restaurar en una base de prueba. Guardar `WANDERBIBLIOTHEK_BACKUP_KEY` fuera
  del servidor y llevar las copias a otro sitio con `WANDERBIBLIOTHEK_BACKUP_HOOK`.
- Firewall del proveedor: 80 y 443 abiertos. Si el panel bloquea SMTP (netcup lo
  hace por defecto), no afecta: la aplicación envía por HTTPS a la API de Brevo,
  no por SMTP.
