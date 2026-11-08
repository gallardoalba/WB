#!/usr/bin/env bash
#
# Despliegue de Wanderbibliothek a partir del repositorio de GitHub.
#
#   sudo deploy/deploy.sh                     # última versión de main
#   sudo deploy/deploy.sh --ref v1.4.0        # una etiqueta o un commit
#   sudo deploy/deploy.sh --dry-run           # enseña lo que haría
#   sudo deploy/deploy.sh --rollback          # vuelve a la release anterior
#
# Crea una release nueva en `<PROJECT_ROOT>/releases/<fecha>-<commit>`, la
# compila, hace una copia de la base, cambia el enlace `current`, reinicia el
# servicio y comprueba `/api/health`. Si la comprobación falla, deja el enlace
# donde estaba y reinicia la versión anterior: el despliegue no puede dejar el
# sitio roto.
#
# Todo se puede ajustar por entorno (útil para probar en un directorio propio):
#   REPO_URL, BRANCH, PROJECT_ROOT, RELEASES_DIR, CURRENT_LINK, SERVICE,
#   HEALTH_URL, KEEP, NODE_BIN, NPM_BIN.
set -euo pipefail

# ── Presentación ───────────────────────────────────────────────────────────
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

step() { STEP=$((STEP + 1)); printf '\n%s── Paso %d: %s%s\n' "$BOLD" "$STEP" "$1" "$NC"; }
ok()   { OK=$((OK + 1));     printf '    %sOK%s    %s\n' "$GREEN" "$NC" "$1"; }
warn() { printf '    %sAVISO%s %s\n' "$YELLOW" "$NC" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '    %sFALLO%s %s\n' "$RED" "$NC" "$1" >&2; }
# Las variables `NEXT_PUBLIC_*` se incrustan en el bundle **al compilar**: si el
# build no las ve, el navegador se queda sin ellas aunque estén en el entorno del
# servicio (le pasa a la clave pública de Turnstile). Se exportan una a una y
# solo esas: el resto del fichero lleva la base real y las claves, que no pintan
# nada en una compilación.
cargar_publicas() {
  [ -r "$ENV_FILE" ] || return 0
  local linea clave valor
  while IFS= read -r linea; do
    case "$linea" in
      NEXT_PUBLIC_*=*)
        clave=${linea%%=*}
        valor=${linea#*=}
        valor=${valor%\"}; valor=${valor#\"}
        valor=${valor%\'}; valor=${valor#\'}
        export "$clave=$valor"
        ;;
    esac
  done < "$ENV_FILE"
}
# ── Configuración ──────────────────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/gallardoalba/wanderbibliothek.git}"
BRANCH="${BRANCH:-main}"
PROJECT_ROOT="${PROJECT_ROOT:-/srv/wanderbibliothek}"
RELEASES_DIR="${RELEASES_DIR:-$PROJECT_ROOT/releases}"
CURRENT_LINK="${CURRENT_LINK:-$PROJECT_ROOT/current}"
SERVICE="${SERVICE:-wanderbibliothek}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/wanderbibliothek}"
BACKUP_SERVICE="${BACKUP_SERVICE:-wanderbibliothek-backup.service}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_TRIES="${HEALTH_TRIES:-30}"
ENV_FILE="${ENV_FILE:-/etc/wanderbibliothek/env}"
KEEP="${KEEP:-5}"
NODE_BIN="${NODE_BIN:-node}"
NPM_BIN="${NPM_BIN:-npm}"

REF=""
DRY_RUN=0
SKIP_BACKUP=0
DO_ROLLBACK=0
START_TIME=$(date +%s)

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Opciones:
  --ref <ref>        Etiqueta, rama o commit a desplegar (por defecto: BRANCH).
  --keep <n>         Releases que se conservan (por defecto 5).
  --skip-backup      No hace copia de la base antes de cambiar de versión.
  --rollback         Vuelve a la release anterior y sale.
  --dry-run          Enseña los comandos sin ejecutarlos.
  -h, --help         Esta ayuda.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:-}"; shift 2 ;;
    --keep) KEEP="${2:-}"; shift 2 ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    --rollback) DO_ROLLBACK=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Opción desconocida: %s\n\n' "$1" >&2; usage; exit 2 ;;
  esac
done

# ── Utilidades ─────────────────────────────────────────────────────────────
# `run` es el único sitio que ejecuta cosas que cambian el sistema: con
# --dry-run solo las imprime.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '    %s→ %s%s\n' "$DIM" "$*" "$NC"
    return 0
  fi
  "$@"
}

need() {
  command -v "$1" >/dev/null 2>&1 || { fail "falta el comando «$1»"; exit 1; }
}

current_release() {
  [ -L "$CURRENT_LINK" ] && readlink -f "$CURRENT_LINK" || true
}

previous_release() {
  # La release más reciente que no es la activa.
  local active
  active="$(current_release)"
  ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | while read -r candidate; do
    candidate="${candidate%/}"
    [ "$candidate" = "$active" ] && continue
    printf '%s\n' "$candidate"
    break
  done
}

health_ok() {
  local tries=$1
  local n=1
  while [ "$n" -le "$tries" ]; do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    n=$((n + 1))
  done
  return 1
}

activate() {
  local release=$1
  run ln -sfn "$release" "$CURRENT_LINK"
  run systemctl restart "$SERVICE"
}

# ── Reversión ──────────────────────────────────────────────────────────────
if [ "$DO_ROLLBACK" -eq 1 ]; then
  target="$(previous_release)"
  if [ -z "$target" ]; then
    fail "no hay otra release en $RELEASES_DIR"
    exit 1
  fi
  step "Volver a $(basename "$target")"
  activate "$target"
  if [ "$DRY_RUN" -eq 0 ] && health_ok "$HEALTH_TRIES"; then
    ok "servicio sano en la versión anterior"
  elif [ "$DRY_RUN" -eq 0 ]; then
    fail "la versión anterior tampoco responde en $HEALTH_URL"
    exit 1
  fi
  exit 0
fi

# ── Paso 1: comprobaciones ────────────────────────────────────────────────
if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  printf 'Hay que ejecutarlo como root:  sudo %s\n' "$0" >&2
  exit 1
fi

printf '%s\n' "${CYAN}${BOLD}"
printf '  ╔══════════════════════════════════════════════════╗\n'
printf '  ║        Wanderbibliothek  ·  Despliegue           ║\n'
printf '  ╚══════════════════════════════════════════════════╝\n'
printf '%s\n' "$NC"

step "Comprobar el entorno"
for cmd in git "$NODE_BIN" "$NPM_BIN" curl; do need "$cmd"; done
if command -v systemctl >/dev/null 2>&1; then
  systemctl cat "$SERVICE" >/dev/null 2>&1 || warn "no encuentro la unidad $SERVICE"
else
  warn "sin systemd: el servicio no se podrá reiniciar desde aquí"
fi

NODE_VERSION="$("$NODE_BIN" -v)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node $NODE_VERSION es demasiado antiguo: hacen falta 22 o más"
  exit 1
fi
ok "Node $NODE_VERSION"
[ -d "$RELEASES_DIR" ] || { fail "no existe $RELEASES_DIR (¿está instalada la aplicación?)"; exit 1; }
ok "releases en $RELEASES_DIR"

# ── Paso 2: resolver la versión ────────────────────────────────────────────
step "Resolver la versión a desplegar"
TARGET_REF="${REF:-$BRANCH}"
REMOTE_LINE="$(git ls-remote "$REPO_URL" "$TARGET_REF" 2>/dev/null | head -1)"
if [ -z "$REMOTE_LINE" ]; then
  # Puede ser un commit suelto: se clona y se resuelve después.
  warn "«$TARGET_REF» no es una rama ni una etiqueta del remoto; se probará como commit"
  COMMIT=""
else
  COMMIT="$(printf '%s' "$REMOTE_LINE" | cut -f1)"
fi
ok "referencia $TARGET_REF${COMMIT:+ → ${COMMIT:0:12}}"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%S)"
SHORT="${COMMIT:0:12}"
[ -n "$SHORT" ] || SHORT="$(date -u +%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$STAMP-$SHORT"

ACTIVE_BEFORE="$(current_release)"
if [ -n "$ACTIVE_BEFORE" ]; then
  ok "activa ahora: $(basename "$ACTIVE_BEFORE")"
else
  warn "no hay enlace current todavía (primer despliegue)"
fi

# ── Paso 3: traer el código ────────────────────────────────────────────────
step "Traer el código de GitHub"
run git clone --quiet --branch "$TARGET_REF" --depth 1 "$REPO_URL" "$RELEASE_DIR" \
  || {
    # Un commit concreto no se puede pedir con --branch: clonar y hacer checkout.
    # El intento anterior puede haber dejado el directorio a medias.
    run rm -rf "$RELEASE_DIR"
    run git clone --quiet "$REPO_URL" "$RELEASE_DIR"
    run git -C "$RELEASE_DIR" -c advice.detachedHead=false checkout --quiet "$TARGET_REF"
  }
if [ "$DRY_RUN" -eq 1 ]; then
  ok "se clonaría en $RELEASE_DIR"
else
  DEPLOYED_COMMIT="$(git -C "$RELEASE_DIR" rev-parse --short HEAD)"
  ok "clonado en $(basename "$RELEASE_DIR") (${DEPLOYED_COMMIT})"
fi

# ── Paso 4: copia de la base ───────────────────────────────────────────────
step "Copia de seguridad de la base"
if [ "$SKIP_BACKUP" -eq 1 ]; then
  warn "omitida a propósito (--skip-backup)"
elif systemctl cat "$BACKUP_SERVICE" >/dev/null 2>&1; then
  # Las migraciones no se deshacen solas: la copia va antes de tocar nada.
  if run systemctl start "$BACKUP_SERVICE"; then
    [ "$DRY_RUN" -eq 0 ] && ok "copia hecha con $BACKUP_SERVICE"
  else
    fail "la copia falló; no se despliega"
    exit 1
  fi
else
  warn "no hay $BACKUP_SERVICE: se continúa sin copia (revisa la instalación)"
fi

# ── Paso 5: compilar ───────────────────────────────────────────────────────
step "Instalar dependencias y compilar"
# Las `NEXT_PUBLIC_*` tienen que estar **antes** del build: se incrustan en el
# bundle. Ver `cargar_publicas`.
cargar_publicas
if [ "$DRY_RUN" -eq 1 ]; then
  run "$NPM_BIN" --prefix "$RELEASE_DIR" ci
  run "$NPM_BIN" --prefix "$RELEASE_DIR" run build
  run "$NPM_BIN" --prefix "$RELEASE_DIR" prune --omit=dev
else
  # El build necesita TypeScript, Tailwind y los tipos: se instala todo y
  # después se recortan las dependencias de desarrollo.
  if "$NPM_BIN" --prefix "$RELEASE_DIR" ci >/tmp/wanderbibliothek-npm-ci.log 2>&1; then
    ok "dependencias instaladas"
  else
    tail -20 /tmp/wanderbibliothek-npm-ci.log >&2
    fail "falló npm ci"
    exit 1
  fi
  if "$NPM_BIN" --prefix "$RELEASE_DIR" run build >/tmp/wanderbibliothek-build.log 2>&1; then
    ok "build terminado"
  else
    tail -30 /tmp/wanderbibliothek-build.log >&2
    fail "falló el build (detalle en /tmp/wanderbibliothek-build.log)"
    exit 1
  fi
  if "$NPM_BIN" --prefix "$RELEASE_DIR" prune --omit=dev >/dev/null 2>&1; then
    ok "dependencias de desarrollo retiradas"
  else
    warn "no se pudieron retirar las devDependencies (no es bloqueante)"
  fi
fi

# ── Paso 6: activar ────────────────────────────────────────────────────────
step "Activar la versión nueva"
activate "$RELEASE_DIR"
[ "$DRY_RUN" -eq 0 ] && ok "enlace current → $(basename "$RELEASE_DIR") y servicio reiniciado"

# ── Paso 7: el vhost de nginx ──────────────────────────────────────────────
# Este script cambia el código, no la configuración del proxy, y ahí estaba la
# trampa: la regla vieja de `/api/requests/` (con barra final) seguía en el
# servidor aunque el repositorio ya la hubiera corregido. Con ella, nginx manda
# `/api/requests` a `/api/requests/`, Next lo devuelve a `/api/requests` y la
# app solo puede decir «el servidor responde con una redirección».
step "Revisar el vhost de nginx"
if ! command -v nginx >/dev/null 2>&1; then
  warn "no hay nginx en este host: no hay vhost que revisar"
elif [ ! -f "$NGINX_SITE" ]; then
  warn "no encuentro $NGINX_SITE: revisa el vhost a mano"
elif grep -qE 'location[[:space:]]+/api/requests/[[:space:]]*\{' "$NGINX_SITE"; then
  # Se cambia solo esa línea: los certificados que puso certbot, las cabeceras
  # y el resto de ubicaciones se quedan como están.
  if run sed -i 's|location /api/requests/ {|location ^~ /api/requests {|' "$NGINX_SITE" \
    && run nginx -t \
    && run systemctl reload nginx; then
    ok "/api/requests se sirve sin barra final (se acabó el bucle 301/308)"
  else
    warn "no se pudo actualizar el vhost: hazlo a mano (ver deploy/README.md)"
  fi
else
  ok "el vhost no tiene la regla que provocaba el bucle"
fi

# ── Paso 8: comprobación (con vuelta atrás) ────────────────────────────────
step "Comprobar el servicio"
if [ "$DRY_RUN" -eq 1 ]; then
  ok "se comprobaría $HEALTH_URL"
elif health_ok "$HEALTH_TRIES"; then
  ok "$HEALTH_URL responde"
else
  fail "$HEALTH_URL no responde tras $HEALTH_TRIES s"
  if [ -n "$ACTIVE_BEFORE" ]; then
    printf '    %sVolviendo a %s%s\n' "$YELLOW" "$(basename "$ACTIVE_BEFORE")" "$NC"
    activate "$ACTIVE_BEFORE"
    if health_ok 10; then
      fail "despliegue revertido: se sigue sirviendo la versión anterior"
    else
      fail "la versión anterior tampoco responde: revisa journalctl -u $SERVICE"
    fi
  else
    fail "no hay versión anterior a la que volver"
  fi
  exit 1
fi

# ── Paso 9: limpiar releases antiguas ──────────────────────────────────────
step "Conservar las últimas $KEEP releases"
if [ "$DRY_RUN" -eq 1 ]; then
  printf '    %s→ se borrarían las anteriores a las %s más recientes%s\n' "$DIM" "$KEEP" "$NC"
else
  ACTIVE_NOW="$(current_release)"
  removed=0
  while read -r old; do
    old="${old%/}"
    [ "$old" = "$ACTIVE_NOW" ] && continue
    rm -rf "$old"
    removed=$((removed + 1))
    printf '    %sborrada %s%s\n' "$DIM" "$(basename "$old")" "$NC"
  done < <(ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n +"$((KEEP + 1))")
  ok "$removed release(s) retirada(s)"
fi

# ── Resumen ────────────────────────────────────────────────────────────────
ELAPSED=$(( $(date +%s) - START_TIME ))
printf '\n%s══════════════════════════════════════════════════%s\n' "$BOLD" "$NC"
printf '   %sDespliegue terminado%s · %s pasos OK, %s fallos\n' "$GREEN" "$NC" "$OK" "$FAIL"
printf '   Versión activa: %s\n' "$(basename "$RELEASE_DIR")"
[ "$DRY_RUN" -eq 1 ] && printf '   %s(simulación: no se ha tocado nada)%s\n' "$DIM" "$NC"
printf '%s══════════════════════════════════════════════════%s\n' "$BOLD" "$NC"
