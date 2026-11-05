# Despliegue en un servidor (systemd + nginx)

Receta para poner Wanderbibliothek en un host Linux propio, con TLS, servicio
supervisado, tareas programadas y copias de seguridad. La aplicación es una sola
instancia de Node con SQLite: **no** se puede replicar horizontalmente (ver
«Límites conocidos»).

## 1. Requisitos

- Debian 12 / Ubuntu 22.04 o similar, 1 vCPU y 1 GB de RAM bastan para empezar.
- Node.js 22 (NodeSource o nvm instalado a nivel de sistema).
- nginx y certbot: `sudo apt install nginx certbot python3-certbot-nginx`.
- `build-essential` y `python3` por si `better-sqlite3` no encuentra binario
  precompilado para tu versión de Node.

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
| `MAIL_WEBHOOK_URL` | Nadie puede confirmar el correo (obligatorio para publicar en producción) ni recuperar la contraseña |
| `APP_ENCRYPTION_KEY` | No se pueden guardar el secreto TOTP ni los datos de envío; sin 2FA la administración responde 403 |
| `APP_ENCRYPTION_OLD_KEYS` | Solo se usa al **rotar** la clave: la nueva en `APP_ENCRYPTION_KEY`, la anterior aquí para seguir leyendo |
| `MAINTENANCE_TOKEN` | El cron responde 404: sin purgas, sin reintentos de correo, sin recordatorios de club |
| `TRUST_PROXY=1` | Todas las peticiones comparten la cuota global: un cliente puede agotar el login del sitio |
| `WANDERBIBLIOTHEK_DB` | La base se crea dentro de la release y se pierde en el siguiente despliegue |
| `LEGAL_CONTROLLER` / `LEGAL_ADDRESS` / `LEGAL_CONTACT_EMAIL` | `/privacidad` y `/aviso-legal` salen con un aviso de que faltan datos; el Impressum es obligatorio en Alemania |

Al arrancar, `[env]` también avisa (sin bloquear) de los errores que solo se
notarían semanas después: un `MAINTENANCE_TOKEN` de menos de 24 caracteres, una
`WANDERBIBLIOTHEK_BACKUP_KEY` que no son 32 bytes (la copia fallaría a las
03:20), rutas de base o de copias relativas, `TRUSTED_PROXY_HOPS` no numérico y
`ADMIN_EMAIL`/`ADMIN_PASSWORD` a medias.

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` (captcha opcional) se **incrusta en el bundle
del cliente**: si lo activas, tiene que existir en el momento del `build`, no
solo en el entorno del servicio. En Docker se pasa como build arg (apartado 11).

> **¿Prefieres contenedores?** Salta al [apartado de Docker](#11-docker) más
> abajo: el mismo entorno sirve, con `WANDERBIBLIOTHEK_DB=/data/wanderbibliothek.db`.

## 5. Servicio, proxy y tareas programadas

```bash
sudo cp deploy/wanderbibliothek.service deploy/wanderbibliothek-maintenance.service \
        deploy/wanderbibliothek-maintenance.timer deploy/wanderbibliothek-backup.service \
        deploy/wanderbibliothek-backup.timer /etc/systemd/system/
sudo ln -sfn /srv/wanderbibliothek/releases/2026-11-04 /srv/wanderbibliothek/current
sudo systemctl daemon-reload
sudo systemctl enable --now wanderbibliothek wanderbibliothek-maintenance.timer wanderbibliothek-backup.timer

sudo cp deploy/nginx.conf /etc/nginx/sites-available/wanderbibliothek
sudo ln -s /etc/nginx/sites-available/wanderbibliothek /etc/nginx/sites-enabled/
sudo certbot --nginx -d biblioteca.example.com
sudo nginx -t && sudo systemctl reload nginx
```

La unidad escucha en `127.0.0.1:3000`; lo público lo sirve nginx. La ubicación
`/api/requests/` va sin buffering y con timeout largo: ahí vive el canal de
mensajería en vivo (SSE).

El `nginx.conf` de `deploy/` añade tres cosas que la aplicación no puede hacer
sola:

- **Límite de ritmo en el borde** (`limit_req`): 10 peticiones/minuto por IP en
  `/api/auth/*` y 300 en el resto. La app ya limita en SQLite, pero cada intento
  rechazado sigue siendo una escritura: el límite del proxy evita que un flood
  convierta el disco en el cuello de botella. El global es holgado a propósito
  (varios usuarios pueden compartir IP detrás de un NAT). Si pones un CDN
  delante, configura `real_ip` o el límite agrupará a todos los visitantes en la
  IP del CDN.
- **`/api/cron/maintenance` solo desde el propio host** (`allow 127.0.0.1;`): el
  token ya la protege, pero no hay razón para exponer una tarea de escritura.
- **TLS sin tickets de sesión** (nginx no rota esa clave por sí solo).

## 6. Primer arranque

```bash
sudo systemctl start wanderbibliothek
sudo journalctl -u wanderbibliothek -f          # busca líneas [env]
curl -fsS https://biblioteca.example.com/api/health
```

La primera petición crea la base y aplica las 28 migraciones, así que puede
tardar unos segundos: hazla tú con el `curl` en lugar de dejarla al primer
visitante.

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

## 8. Copias de seguridad y restauración

- Diaria a las 03:20 (`wanderbibliothek-backup.timer`), con `integrity_check` y rotación
  de 14 copias.
- Con `WANDERBIBLIOTHEK_BACKUP_KEY` las copias se cifran (AES-256-GCM) y el `.db` plano
  se borra. **Guarda esa clave fuera del servidor**: sin ella las copias no
  sirven.
- `WANDERBIBLIOTHEK_BACKUP_HOOK` permite enviarlas fuera (`rsync`, `rclone`, S3).

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

## 9. Diagnóstico rápido

| Síntoma | Causa habitual |
|---|---|
| Todo responde 500 y el log dice `[env] ERROR …` | Falta una variable obligatoria del punto 4 |
| El login «funciona» pero al recargar no hay sesión | El sitio se sirve por HTTP: la cookie `__Host-` necesita TLS |
| No llegan correos de verificación | `MAIL_WEBHOOK_URL` vacío o proveedor rechazando; los reintentos se ven en el outbox del cron |
| `/admin` y las rutas de moderación dan 403 | La cuenta admin no tiene 2FA activa (o falta `APP_ENCRYPTION_KEY`) |
| 429 para todo el mundo | `TRUST_PROXY` sin activar: todas las IP comparten la cuota `direct` |
| 429 solo en `/api/auth/*` con `limit_req` en el log | El límite de nginx: 10 peticiones/minuto por IP. Sube `rate`/`burst` si hay un CDN delante sin `real_ip` |
| `/api/cron/maintenance` responde 403 al llamarlo desde fuera | Correcto: nginx solo lo deja entrar desde loopback |
| Los mensajes nuevos no aparecen solos | nginx con buffering en `/api/requests/` |
| El disco crece y la base no baja | Normal: SQLite no compacta al borrar; el mantenimiento hace `PRAGMA optimize` y `wal_checkpoint(TRUNCATE)` |
| No hay copias en `/var/backups/wanderbibliothek` | Mira `journalctl -u wanderbibliothek-backup`; si el log habla de `tsx`, la release se instaló sin dependencias de producción o falta el `WorkingDirectory` |
| `Failed to start server … EADDRINUSE` | Hay otro `next start` o un `.next` de otra release |

## 10. Límites conocidos

- **Una sola instancia.** SQLite (un escritor) y el bus de avisos en memoria no
  admiten varias réplicas. Escalar exige PostgreSQL y Redis/pubsub.
- **Los scripts de operación necesitan `tsx`**, que está en `dependencies` a
  propósito (no es una devDependency): así funcionan también con
  `npm ci --omit=dev` y dentro de la imagen.
- **La base no se migra hacia atrás**: ante un despliegue que cambie el esquema,
  la copia previa es la vuelta atrás.
- **Los registros van a journald** (`journalctl -u wanderbibliothek`) en host, y a
  `docker compose logs` en contenedor. Con `ERROR_WEBHOOK_URL` se reenvían además
  los errores a un servicio externo.

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
- Las releases se cambian con `docker compose build` + `up -d`: el volumen de
datos sobrevive.
- El build de la imagen se valida en CI (job `imagen`), no hace falta compilarla
  en el servidor.

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
avisos, listas, clubes propios, bloqueos, tokens, marcas de lectura y notas
personales de sus ejemplares; los mensajes y valoraciones se conservan con el
autor ya anonimizado porque son parte del historial de otras personas. La base
usa `secure_delete`, así que el contenido borrado no queda en las páginas
libres del fichero.

Salvaguardas que ya trae la aplicación: las cuotas guardan un **pseudónimo
diario** de la IP (HMAC con una sal derivada de `APP_ENCRYPTION_KEY`, no la
dirección), las **portadas se descargan en el servidor** y se cachean en
`WANDERBIBLIOTHEK_COVER_CACHE` (el navegador no contacta con Open Library), el
catálogo y los perfiles **exigen sesión** y `robots.txt` impide indexarlos, y
el registro exige **declarar 16 años o más**.

Quedan tres decisiones que son tuyas:

1. **Datos del responsable.** `/privacidad` y `/aviso-legal` ya existen, en
   castellano y alemán, con lo que el código hace de verdad. Se completan con
   `LEGAL_CONTROLLER`, `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL` y, si procede,
   `LEGAL_VAT_ID`; sin ellas las páginas muestran un aviso visible de que están
   incompletas y el arranque lo recuerda en el log. El texto sigue siendo un
   borrador técnico: revísalo con quien asuma la responsabilidad legal.
2. **Copias de seguridad.** Cada copia contiene datos que quizá ya se borraron
   de la base: se conservan `WANDERBIBLIOTHEK_BACKUP_KEEP` días (14 por
   defecto). La política lo declara; no restaures una copia para uso normal.
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
- [ ] Ensayada una restauración real desde copia y confirmado el plazo de 14
      días que declara la política.
- [ ] Texto revisado por quien asuma la responsabilidad legal: lo que hay es un
      borrador técnico exacto, no un dictamen jurídico.

## Rotar la clave de cifrado

`APP_ENCRYPTION_KEY` protege el secreto TOTP de cada cuenta y los datos de envío
(Packstation o dirección). Los valores guardan dentro el id de la clave con la que
se cifraron, así que se puede cambiar sin perder nada:

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
