#!/usr/bin/env bash
#
# Instalación inicial de Wanderbibliothek en un servidor vacío (Debian/Ubuntu).
#
#   sudo deploy/bootstrap.sh --domain wanderbibliothek.org --email tu@correo.de
#
# Deja el sitio servido por nginx con TLS, el servicio en systemd, las tareas
# programadas y la copia diaria. Es idempotente en lo importante: no pisa un
# `/etc/wanderbibliothek/env` existente, no sobrescribe vhosts sin guardar copia
# y no toca otras webs del servidor (solo añade su propio fichero de nginx).
#
# Lo que NO hace: rellenar los datos del proveedor de correo ni los del
# Impressum. Sin `MAIL_WEBHOOK_URL` nadie puede confirmar su cuenta, así que el
# script termina recordándolo.
#
#   --domain <nombre>   Dominio público (obligatorio).
#   --email <correo>    Correo para Let's Encrypt; si falta, no pide certificado.
#   --repo <url>        Repositorio a desplegar (por defecto, el oficial).
#   --branch <rama>     Rama a desplegar (por defecto main).
#   --dry-run           Enseña lo que haría, sin ejecutar.
set -euo pipefail

BOLD=$'\033[1m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
RED=$'\033[0;31m'
CYAN=$'\033[0;36m'
DIM=$'\033[2m'
NC=$'\033[0m'

STEP=0
OK=0
FAIL=0
START_TIME=$(date +%s)

step() { STEP=$((STEP + 1)); printf '\n%s── Paso %d: %s%s\n' "$BOLD" "$STEP" "$1" "$NC"; }
ok()   {
  OK=$((OK + 1))
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '    %sOK%s    %s %s(simulado)%s\n' "$GREEN" "$NC" "$1" "$DIM" "$NC"
  else
    printf '    %sOK%s    %s\n' "$GREEN" "$NC" "$1"
  fi
}
warn() { printf '    %sAVISO%s %s\n' "$YELLOW" "$NC" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '    %sFALLO%s %s\n' "$RED" "$NC" "$1" >&2; }

DOMAIN=""
EMAIL=""
REPO_URL="${REPO_URL:-https://github.com/gallardoalba/wanderbibliothek.git}"
BRANCH="${BRANCH:-main}"
DRY_RUN=0

APP_USER="${APP_USER:-wanderbibliothek}"
PROJECT_ROOT="${PROJECT_ROOT:-/srv/wanderbibliothek}"
RELEASES_DIR="$PROJECT_ROOT/releases"
CURRENT_LINK="$PROJECT_ROOT/current"
DATA_DIR="${DATA_DIR:-/var/lib/wanderbibliothek}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wanderbibliothek}"
ENV_FILE="${ENV_FILE:-/etc/wanderbibliothek/env}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/wanderbibliothek}"
SERVICE="wanderbibliothek"

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage 0 ;;
    *) printf 'Opción desconocida: %s\n\n' "$1" >&2; usage 2 ;;
  esac
done

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '    %s→ %s%s\n' "$DIM" "$*" "$NC"
    return 0
  fi
  "$@"
}

have() { command -v "$1" >/dev/null 2>&1; }

apt_install() {
  # `apt-get install` es idempotente: si ya están, no hace nada.
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" >/dev/null
}

random_hex() { openssl rand -hex 32; }

# ── Paso 1: comprobaciones previas ─────────────────────────────────────────
printf '%s\n' "${CYAN}${BOLD}"
printf '  ╔══════════════════════════════════════════════════╗\n'
printf '  ║      Wanderbibliothek  ·  Instalación            ║\n'
printf '  ╚══════════════════════════════════════════════════╝\n'
printf '%s\n' "$NC"

step "Comprobar el servidor"
if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  fail "hay que ejecutarlo como root:  sudo $0 --domain …"
  exit 1
fi
if [ -z "$DOMAIN" ]; then
  fail "falta --domain (por ejemplo --domain wanderbibliothek.org)"
  usage 2
fi
if ! grep -qiE '^(ID=debian|ID=ubuntu|ID_LIKE=.*(debian|ubuntu))' /etc/os-release 2>/dev/null; then
  warn "no parece Debian/Ubuntu; los paquetes pueden llamarse de otra forma"
else
  ok "$(. /etc/os-release; printf '%s %s' "$NAME" "$VERSION_ID")"
fi

# Apache y nginx no pueden compartir los puertos 80/443: si hay Apache
# escuchando, esto no es el sitio donde instalar sin decidir antes qué pasa
# con la web actual.
if have apache2 && systemctl is-active --quiet apache2 2>/dev/null; then
  fail "Apache está en marcha y ocuparía los puertos 80/443"
  printf '    %sPara convivir con él, publica la aplicación detrás de Apache (ProxyPass) o\n' "$DIM"
  printf '    desactiva Apache antes de seguir (%s).\n' "$NC"
  exit 1
fi

# Lo mismo con Docker: si un contenedor publica 80/443 (lo habitual en una web
# anterior), el nginx del host no puede arrancar y el fallo aparece más tarde y
# peor. Se detecta aquí y se explica qué hacer.
if have docker && docker info >/dev/null 2>&1; then
  PUBLISHING="$(docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | grep -E ':(80|443)->' || true)"
  if [ -n "$PUBLISHING" ]; then
    fail "hay contenedores publicando 80/443:"
    printf '%s\n' "$PUBLISHING" | while IFS=$'\t' read -r name ports; do
      printf '      %s - %s\n' "$name" "$ports"
    done
    cat <<EOF
    ${DIM}Para convivir, deja esos contenedores en 127.0.0.1:8080 (por ejemplo
    "127.0.0.1:8080:80" en su docker-compose.yml), pon delante este nginx y
    dedica un vhost al sitio antiguo con "proxy_pass http://127.0.0.1:8080".
    Para sustituir la web anterior: ${NC}docker compose down${DIM} en su carpeta
    (los ficheros se quedan donde estén) y vuelve a lanzar este script.${NC}
EOF
    exit 1
  fi
fi

if ss -ltn 2>/dev/null | grep -qE ':(80|443) '; then
  warn "alguien más escucha ya en 80/443 (¿otro nginx?)"
else
  ok "puertos 80/443 libres para nginx"
fi

# ── Paso 2: paquetes del sistema ───────────────────────────────────────────
step "Instalar paquetes del sistema"
if have apt-get; then
  run env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null
  apt_install ca-certificates curl git build-essential python3 openssl
  apt_install nginx certbot python3-certbot-nginx
  ok "nginx, certbot y herramientas de compilación"
else
  fail "no hay apt-get: instala a mano nginx, certbot, git, python3 y build-essential"
  exit 1
fi

# ── Paso 3: Node 22 ────────────────────────────────────────────────────────
step "Comprobar Node.js"
NODE_OK=0
if have node; then
  NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "$NODE_MAJOR" -ge 22 ] && NODE_OK=1 && ok "Node $(node -v)"
fi
if [ "$NODE_OK" -eq 0 ]; then
  warn "hace falta Node 22: se instala desde NodeSource (deja /usr/bin/node, que es lo que espera la unidad de systemd)"
  if [ "$DRY_RUN" -eq 1 ]; then
    run "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
    apt_install nodejs
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    apt_install nodejs
    node -v | grep -q '^v2[2-9]' || { fail "Node instalado no es 22+: $(node -v)"; exit 1; }
    ok "Node $(node -v)"
  fi
fi

# La unidad de systemd llama a /usr/bin/node: con nvm o con un Node de otra
# ruta el servicio arrancaría sin encontrarlo.
if [ "$DRY_RUN" -eq 0 ] && [ ! -x /usr/bin/node ]; then
  warn "/usr/bin/node no existe; ajusta ExecStart en deploy/wanderbibliothek.service"
fi

# ── Paso 4: memoria de intercambio ─────────────────────────────────────────
step "Memoria disponible"
MEM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)"
ok "${MEM_MB} MB de RAM"
if [ "$MEM_MB" -lt 2000 ] && ! swapon --show=NAME --noheadings 2>/dev/null | grep -q .; then
  warn "menos de 2 GB y sin swap: el build de Next puede quedarse sin memoria"
  if [ ! -f /swapfile ]; then
    run fallocate -l 2G /swapfile
    run chmod 600 /swapfile
    run mkswap /swapfile >/dev/null
    run swapon /swapfile
    run sh -c 'grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab'
    ok "2 GB de swap activados"
  fi
else
  ok "swap suficiente"
fi

# ── Paso 5: usuario y directorios ──────────────────────────────────────────
step "Crear usuario y directorios"
if id "$APP_USER" >/dev/null 2>&1; then
  ok "el usuario $APP_USER ya existe"
else
  run useradd --system --home "$PROJECT_ROOT" --shell /usr/sbin/nologin "$APP_USER"
  ok "usuario $APP_USER creado"
fi
run mkdir -p "$RELEASES_DIR" "$DATA_DIR" "$BACKUP_DIR" "$(dirname "$ENV_FILE")"
run chown -R "$APP_USER:$APP_USER" "$PROJECT_ROOT" "$DATA_DIR" "$BACKUP_DIR"
ok "$PROJECT_ROOT, $DATA_DIR y $BACKUP_DIR"

# ── Paso 6: traer y compilar la aplicación ─────────────────────────────────
step "Descargar y compilar"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%S)"
COMMIT="$(git ls-remote "$REPO_URL" "$BRANCH" 2>/dev/null | head -1 | cut -f1)"
RELEASE_DIR="$RELEASES_DIR/$STAMP-${COMMIT:0:12}"
run git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$RELEASE_DIR"
if [ "$DRY_RUN" -eq 1 ]; then
  run npm --prefix "$RELEASE_DIR" ci
  run npm --prefix "$RELEASE_DIR" run build
  run npm --prefix "$RELEASE_DIR" prune --omit=dev
  ok "se compilaría en $(basename "$RELEASE_DIR")"
else
  chown -R "$APP_USER:$APP_USER" "$RELEASE_DIR"
  if sudo -u "$APP_USER" npm --prefix "$RELEASE_DIR" ci >/tmp/wb-bootstrap-ci.log 2>&1; then
    ok "dependencias instaladas"
  else
    tail -20 /tmp/wb-bootstrap-ci.log >&2
    fail "falló npm ci"
    exit 1
  fi
  if sudo -u "$APP_USER" npm --prefix "$RELEASE_DIR" run build >/tmp/wb-bootstrap-build.log 2>&1; then
    ok "build terminado"
  else
    tail -30 /tmp/wb-bootstrap-build.log >&2
    fail "falló el build"
    exit 1
  fi
  sudo -u "$APP_USER" npm --prefix "$RELEASE_DIR" prune --omit=dev >/dev/null 2>&1 || true
  run ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
  ok "current → $(basename "$RELEASE_DIR")"
fi

# ── Paso 7: entorno ────────────────────────────────────────────────────────
step "Configurar el entorno"
if [ -f "$ENV_FILE" ]; then
  warn "$ENV_FILE ya existe: no lo toco (revísalo a mano)"
else
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '    %s→ escribiría %s con secretos nuevos%s\n' "$DIM" "$ENV_FILE" "$NC"
  else
    KEY="$(openssl rand -hex 32)"
    MAINT_TOKEN="$(openssl rand -hex 32)"
    cat >"$ENV_FILE" <<EOF
# Generado por deploy/bootstrap.sh el $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Cambios aquí: sudo systemctl restart $SERVICE

NEXT_PUBLIC_SITE_URL=https://$DOMAIN

# Sin proveedor de correo nadie puede confirmar su cuenta ni recuperar la
# contraseña. Rellena esta URL y su token (ver deploy/README.md, apartado 4).
MAIL_WEBHOOK_URL=
MAIL_WEBHOOK_TOKEN=

# Cifra el secreto TOTP y los datos de envío. No la cambies sin rotar:
# `npm run rotate:secrets` (deploy/README.md).
APP_ENCRYPTION_KEY=$KEY

WANDERBIBLIOTHEK_DB=$DATA_DIR/wanderbibliothek.db
TRUST_PROXY=1
TRUSTED_PROXY_HOPS=1
MAINTENANCE_TOKEN=$MAINT_TOKEN

WANDERBIBLIOTHEK_BACKUP_DIR=$BACKUP_DIR
WANDERBIBLIOTHEK_BACKUP_KEEP=14
WANDERBIBLIOTHEK_BACKUP_KEY=
EOF
    chown root:root "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok "$ENV_FILE con secretos nuevos (solo root)"
    # El correo es obligatorio en producción: mientras falte, la aplicación
    # responde 500 a propósito (ver src/lib/env-check.ts). Mejor decirlo aquí
    # que dejar que lo descubra quien abra el navegador.
    if ! grep -qE '^MAIL_WEBHOOK_URL=.+' "$ENV_FILE"; then
      warn "sin MAIL_WEBHOOK_URL el sitio responderá 500 hasta que la rellenes"
      printf '    %sEs el aviso del comprobador de entorno, no un fallo de la instalación.\n' "$DIM"
      printf '    Para verlo funcionando sin correo: añade WANDERBIBLIOTHEK_SKIP_ENV_CHECK=1%s\n' "$NC"
    fi
  fi
fi

# ── Paso 8: servicio y tareas programadas ──────────────────────────────────
step "Instalar servicio y temporizadores"
if [ "$DRY_RUN" -eq 1 ]; then
  run "cp $CURRENT_LINK/deploy/wanderbibliothek*.service|.timer /etc/systemd/system/"
  run systemctl daemon-reload
  run systemctl enable --now "$SERVICE" wanderbibliothek-maintenance.timer wanderbibliothek-backup.timer
  ok "unidades instaladas"
else
  for unit in wanderbibliothek.service wanderbibliothek-maintenance.service \
              wanderbibliothek-maintenance.timer wanderbibliothek-backup.service \
              wanderbibliothek-backup.timer; do
    install -m 644 "$CURRENT_LINK/deploy/$unit" /etc/systemd/system/"$unit"
  done
  systemctl daemon-reload
  systemctl enable --now "$SERVICE" wanderbibliothek-maintenance.timer wanderbibliothek-backup.timer >/dev/null 2>&1
  ok "servicio y temporizadores activos"
fi

# ── Paso 9: nginx ──────────────────────────────────────────────────────────
step "Publicar con nginx"
if [ "$DRY_RUN" -eq 1 ]; then
  run "escribir $NGINX_SITE (80 → 127.0.0.1:3000) y recargar nginx"
  [ -n "$EMAIL" ] && run "certbot --nginx -d $DOMAIN -d www.$DOMAIN"
  ok "vhost preparado"
else
  if [ -f "$NGINX_SITE" ]; then
    cp "$NGINX_SITE" "$NGINX_SITE.bak-$(date -u +%Y-%m-%dT%H-%M-%S)"
    warn "el vhost anterior se guardó como $NGINX_SITE.bak-…"
  fi
  # Primero solo HTTP: el certificado todavía no existe y un `listen 443` sin
  # certificado impide arrancar nginx.
  cat >"$NGINX_SITE" <<EOF
# Generado por deploy/bootstrap.sh: HTTP + proxy a la aplicación.
# Tras certbot, este fichero se sustituye por deploy/nginx.conf (límites de
# ritmo, SSE sin buffering y cabeceras).
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/wanderbibliothek
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "nginx sirviendo en HTTP"
fi

# ── Paso 10: certificado ───────────────────────────────────────────────────
step "Certificado TLS"
if [ -z "$EMAIL" ]; then
  warn "sin --email no se pide certificado. Cuando el DNS apunte aquí:"
  printf '    %ssudo certbot --nginx -d %s -d www.%s%s\n' "$DIM" "$DOMAIN" "$DOMAIN" "$NC"
  printf '    %ssudo cp %s/deploy/nginx.conf %s && sudo nginx -t && sudo systemctl reload nginx%s\n' \
    "$DIM" "$CURRENT_LINK" "$NGINX_SITE" "$NC"
elif [ "$DRY_RUN" -eq 1 ]; then
  run "certbot --nginx --non-interactive --agree-tos -m $EMAIL -d $DOMAIN -d www.$DOMAIN"
  ok "certificado (simulado)"
else
  # certbot necesita que el DNS ya resuelva a este servidor.
  RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}')"
  MINE="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
  if [ -n "$RESOLVED" ] && [ "$RESOLVED" != "$MINE" ]; then
    warn "$DOMAIN resuelve a $RESOLVED y este servidor tiene $MINE"
    warn "se omite certbot hasta que el DNS apunte aquí"
  elif certbot --nginx --non-interactive --agree-tos -m "$EMAIL" \
        -d "$DOMAIN" -d "www.$DOMAIN" >/tmp/wb-certbot.log 2>&1; then
    ok "certificado emitido"
    # Ahora que hay certificado se instala el vhost completo del repositorio.
    sed "s/biblioteca\.example\.com/$DOMAIN/g" "$CURRENT_LINK/deploy/nginx.conf" >"$NGINX_SITE"
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx
      ok "vhost completo (límites de ritmo, SSE, cabeceras)"
    else
      warn "el vhost completo no valida: se deja el simple (mira nginx -t)"
    fi
  else
    tail -15 /tmp/wb-certbot.log >&2
    fail "certbot falló (detalle en /tmp/wb-certbot.log)"
  fi
fi

# ── Paso 11: primer arranque ───────────────────────────────────────────────
step "Arrancar y comprobar"
if [ "$DRY_RUN" -eq 1 ]; then
  ok "se arrancaría el servicio y se pediría /api/health"
else
  systemctl restart "$SERVICE"
  for _ in $(seq 1 30); do
    curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break
    sleep 1
  done
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    ok "la aplicación responde en 127.0.0.1:3000"
  else
    fail "no responde; mira: journalctl -u $SERVICE -n 40"
    # El entorno incompleto no se ve como `[env] …` en todos los casos: al
    # abortar el arranque, Next registra su propio mensaje («Entorno de
    # producción incompleto (…»). Se miran las dos formas.
    LOG_TAIL="$(journalctl -u "$SERVICE" -n 40 --no-pager 2>/dev/null || true)"
    ENV_LINES="$(printf '%s\n' "$LOG_TAIL" | grep -F '[env]' || true)"
    [ -n "$ENV_LINES" ] && printf '%s\n' "$ENV_LINES"
    if printf '%s' "$LOG_TAIL" | grep -q 'MAIL_WEBHOOK_URL'; then
      warn "es lo esperado sin proveedor de correo: rellena MAIL_WEBHOOK_URL en $ENV_FILE"
      printf '    %sSe puede arrancar sin él con WANDERBIBLIOTHEK_SKIP_ENV_CHECK=1 (solo para probar)%s\n' "$DIM" "$NC"
    elif printf '%s' "$LOG_TAIL" | grep -q 'NEXT_PUBLIC_SITE_URL'; then
      warn "revisa NEXT_PUBLIC_SITE_URL en $ENV_FILE: debe empezar por https://"
    elif printf '%s' "$LOG_TAIL" | grep -q 'Entorno de producción incompleto'; then
      warn "el entorno está incompleto: mira la línea «Entorno de producción incompleto (…» de arriba"
    fi
  fi
fi

# ── Resumen ────────────────────────────────────────────────────────────────
ELAPSED=$(( $(date +%s) - START_TIME ))
printf '\n%s══════════════════════════════════════════════════%s\n' "$BOLD" "$NC"
printf '   %sInstalación terminada%s en %ss · %s pasos OK, %s fallos\n' \
  "$GREEN" "$NC" "$ELAPSED" "$OK" "$FAIL"
printf '   Sitio: %shttps://%s%s\n' "$CYAN" "$DOMAIN" "$NC"
printf '%s══════════════════════════════════════════════════%s\n' "$BOLD" "$NC"
cat <<EOF

${BOLD}Falta lo que ningún script puede adivinar:${NC}
  1. Correo: rellena MAIL_WEBHOOK_URL y MAIL_WEBHOOK_TOKEN en $ENV_FILE
     y reinicia (sudo systemctl restart $SERVICE). Sin esto nadie puede
     confirmar su cuenta, y en producción la confirmación es obligatoria.
  2. Impressum: LEGAL_CONTROLLER, LEGAL_ADDRESS y LEGAL_CONTACT_EMAIL
     (obligatorio en Alemania; ver deploy/README.md, apartado 13).
  3. Cuenta de administración:
       sudo -u $APP_USER ADMIN_PASSWORD='algo-largo' \\
         npm --prefix $CURRENT_LINK run admin:create -- admin@$DOMAIN
     Después entra en /cuenta, activa la verificación en dos pasos y borra
     ADMIN_PASSWORD del entorno.
  4. Copias: guarda WANDERBIBLIOTHEK_BACKUP_KEY fuera del servidor y lee el
     apartado 8 de deploy/README.md para ensayar una restauración.

${BOLD}Para las siguientes versiones:${NC}
  sudo $PROJECT_ROOT/current/deploy/deploy.sh
EOF
