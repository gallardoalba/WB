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
sudo useradd --system --home /srv/book2peer --shell /usr/sbin/nologin book2peer
sudo mkdir -p /srv/book2peer/releases /var/lib/book2peer /var/backups/book2peer
sudo chown -R book2peer:book2peer /srv/book2peer /var/lib/book2peer /var/backups/book2peer
```

- `/srv/book2peer/releases/<fecha>/` — cada versión desplegada.
- `/srv/book2peer/current` — enlace simbólico a la versión activa.
- `/var/lib/book2peer/book2peer.db` — la base (fuera de la aplicación).
- `/var/backups/book2peer/` — copias.
- `/etc/book2peer/env` — variables de entorno del servicio (solo root).

## 3. Instalación de dependencias

```bash
cd /srv/book2peer/releases/2026-11-04
npm ci
npm run build
```

`npm ci` incluye **devDependencies** a propósito: los guiones de operación
(`admin:create`, `db:backup`, `user:verify`, `smoke`) se ejecutan con `tsx`, que
vive ahí. Si necesitas un artefacto mínimo con `npm ci --omit=dev`, tendrás que
compilar antes esos scripts a JavaScript o ejecutarlos desde otra copia.

El build **no** necesita base de datos ni variables de entorno: se puede hacer
en CI y desplegar el artefacto.

## 4. Entorno

```bash
sudo mkdir -p /etc/book2peer
sudo install -m 600 -o root -g root deploy/env.example /etc/book2peer/env
sudo -e /etc/book2peer/env          # rellena URL, correo y secretos
```

Genera los secretos con `openssl rand -hex 32`. Las variables obligatorias y sus
consecuencias están comentadas en el propio fichero; el resumen:

| Variable | Si falta |
|---|---|
| `NEXT_PUBLIC_SITE_URL` (https) | Sitemap y canonical apuntan a localhost; con `http://` el navegador descarta la cookie `__Host-` y el login entra en bucle |
| `MAIL_WEBHOOK_URL` | Nadie puede confirmar el correo (obligatorio para publicar en producción) ni recuperar la contraseña |
| `APP_ENCRYPTION_KEY` | No se puede guardar el secreto TOTP ⇒ sin 2FA la administración responde 403 |
| `MAINTENANCE_TOKEN` | El cron responde 404: sin purgas, sin reintentos de correo, sin recordatorios de club |
| `TRUST_PROXY=1` | Todas las peticiones comparten la cuota global: un cliente puede agotar el login del sitio |
| `BOOK2PEER_DB` | La base se crea dentro de la release y se pierde en el siguiente despliegue |

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` (captcha opcional) se **incrusta en el bundle
del cliente**: si lo activas, tiene que existir en el momento del `build`, no
solo en el entorno del servicio.

## 5. Servicio, proxy y tareas programadas

```bash
sudo cp deploy/book2peer.service deploy/book2peer-maintenance.service \
        deploy/book2peer-maintenance.timer deploy/book2peer-backup.service \
        deploy/book2peer-backup.timer /etc/systemd/system/
sudo ln -sfn /srv/book2peer/releases/2026-11-04 /srv/book2peer/current
sudo systemctl daemon-reload
sudo systemctl enable --now book2peer book2peer-maintenance.timer book2peer-backup.timer

sudo cp deploy/nginx.conf /etc/nginx/sites-available/book2peer
sudo ln -s /etc/nginx/sites-available/book2peer /etc/nginx/sites-enabled/
sudo certbot --nginx -d biblioteca.example.com
sudo nginx -t && sudo systemctl reload nginx
```

La unidad escucha en `127.0.0.1:3000`; lo público lo sirve nginx. La ubicación
`/api/requests/` va sin buffering y con timeout largo: ahí vive el canal de
mensajería en vivo (SSE).

## 6. Primer arranque

```bash
sudo systemctl start book2peer
sudo journalctl -u book2peer -f          # busca líneas [env]
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
sudo -u book2peer ADMIN_PASSWORD='contraseña-larga' \
  npm --prefix /srv/book2peer/current run admin:create -- admin@biblioteca.example.com
```

Entra en `/cuenta`, activa la verificación en dos pasos (obligatoria para
moderar en producción) y después **borra `ADMIN_PASSWORD`** del entorno:

```bash
sudo -e /etc/book2peer/env      # elimina ADMIN_EMAIL y ADMIN_PASSWORD
sudo systemctl restart book2peer
```

Comprobación final:

```bash
BASE_URL=https://biblioteca.example.com npm --prefix /srv/book2peer/current run smoke
```

## 7. Despliegue de una versión nueva

```bash
# 1) Copia antes de tocar nada (las migraciones no se deshacen solas)
sudo systemctl start book2peer-backup.service

# 2) Nueva release y build (puede hacerse en CI y copiarse)
cd /srv/book2peer/releases && git clone --depth 1 … 2026-11-20
cd 2026-11-20 && npm ci && npm run build

# 3) Cambiar el enlace y reiniciar
sudo ln -sfn /srv/book2peer/releases/2026-11-20 /srv/book2peer/current
sudo systemctl restart book2peer

# 4) Comprobar y, si algo va mal, volver atrás
curl -fsS https://biblioteca.example.com/api/health
BASE_URL=https://biblioteca.example.com npm --prefix /srv/book2peer/current run smoke
# vuelta atrás:
# sudo ln -sfn /srv/book2peer/releases/2026-11-04 /srv/book2peer/current && sudo systemctl restart book2peer
```

Las releases antiguas se pueden borrar cuando la copia de seguridad de esa fecha
ya esté fuera del servidor.

## 8. Copias de seguridad y restauración

- Diaria a las 03:20 (`book2peer-backup.timer`), con `integrity_check` y rotación
  de 14 copias.
- Con `BOOK2PEER_BACKUP_KEY` las copias se cifran (AES-256-GCM) y el `.db` plano
  se borra. **Guarda esa clave fuera del servidor**: sin ella las copias no
  sirven.
- `BOOK2PEER_BACKUP_HOOK` permite enviarlas fuera (`rsync`, `rclone`, S3).

Restauración (ensáyala antes de necesitarla):

```bash
sudo systemctl stop book2peer
sudo -u book2peer node --import tsx /srv/book2peer/current/scripts/decrypt-backup.ts \
  /var/backups/book2peer/book2peer-2026-11-04T03-20-00-000Z.db.enc /tmp/restore.db
sudo install -m 600 -o book2peer -g book2peer /tmp/restore.db /var/lib/book2peer/book2peer.db
sudo rm -f /var/lib/book2peer/book2peer.db-wal /var/lib/book2peer/book2peer.db-shm
sudo systemctl start book2peer
curl -fsS https://biblioteca.example.com/api/health
```

## 9. Diagnóstico rápido

| Síntoma | Causa habitual |
|---|---|
| Todo responde 500 y el log dice `[env] ERROR …` | Falta una variable obligatoria del punto 4 |
| El login «funciona» pero al recargar no hay sesión | El sitio se sirve por HTTP: la cookie `__Host-` necesita TLS |
| No llegan correos de verificación | `MAIL_WEBHOOK_URL` vacío o proveedor rechazando; los reintentos se ven en el outbox del cron |
| `/admin` y las rutas de moderación dan 403 | La cuenta admin no tiene 2FA activa (o falta `APP_ENCRYPTION_KEY`) |
| 429 para todo el mundo | `TRUST_PROXY` sin activar: todas las IP comparten la cuota `direct` |
| Los mensajes nuevos no aparecen solos | nginx con buffering en `/api/requests/` |
| El disco crece y la base no baja | Normal: SQLite no compacta al borrar; el mantenimiento hace `PRAGMA optimize` y `wal_checkpoint(TRUNCATE)` |
| `Failed to start server … EADDRINUSE` | Hay otro `next start` o un `.next` de otra release |

## 10. Límites conocidos

- **Una sola instancia.** SQLite (un escritor) y el bus de avisos en memoria no
  admiten varias réplicas. Escalar exige PostgreSQL y Redis/pubsub.
- **El servicio necesita `tsx`** para las tareas programadas y los scripts.
- **La base no se migra hacia atrás**: ante un despliegue que cambie el esquema,
  la copia previa es la vuelta atrás.
- **Los registros van a journald** (`journalctl -u book2peer`). Con
  `ERROR_WEBHOOK_URL` se reenvían además los errores a un servicio externo.
