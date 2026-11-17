#!/usr/bin/env bash
#
# Ensayo de restauración de la copia más reciente, con el mismo código que
# sirve la web. Se ejecuta desde un temporizador semanal: una copia que existe
# no es una copia que restaura, y descubrirlo el día del incidente es tarde.
set -euo pipefail

fail() { printf 'FALLO: %s\n' "$*" >&2; exit 1; }
VERIFY_ENV_FILE=""
cleanup_verify_env() {
  [ -z "$VERIFY_ENV_FILE" ] || rm -f -- "$VERIFY_ENV_FILE"
}
trap cleanup_verify_env EXIT

DOCKER="${DOCKER_BIN:-/usr/bin/docker}"
APP_USER="${WANDERBIBLIOTHEK_USER:-wanderbibliothek}"
CODE_DIR="${WANDERBIBLIOTHEK_CODE_DIR:-/srv/wanderbibliothek/current}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_KEY_LIBRARY=/usr/local/lib/wanderbibliothek/backup-key.sh
if [ ! -r "$BACKUP_KEY_LIBRARY" ]; then BACKUP_KEY_LIBRARY="$SCRIPT_DIR/backup-key.sh"; fi
[ -r "$BACKUP_KEY_LIBRARY" ] || fail "falta el validador de clave de copia"
# shellcheck source=deploy/backup-key.sh
. "$BACKUP_KEY_LIBRARY"

APP_EXEC_START="$(systemctl show --property=ExecStart --value wanderbibliothek.service)" ||
  fail "no se pudo determinar el modo de despliegue de wanderbibliothek.service"

verify_from_code() {
  local app_home
  [ -f "$CODE_DIR/scripts/verify-backup.ts" ] ||
    fail "no existe el script de verificación en $CODE_DIR"
  validate_backup_key "${WANDERBIBLIOTHEK_BACKUP_KEY:-}" ||
    fail "falta una clave válida; no se puede ensayar la restauración"
  command -v runuser >/dev/null 2>&1 || fail "falta runuser para ejecutar como $APP_USER"
  getent passwd "$APP_USER" >/dev/null || fail "no existe el usuario $APP_USER"
  app_home="$(getent passwd "$APP_USER" | cut -d: -f6)"
  cd "$CODE_DIR"
  exec runuser --preserve-environment --user "$APP_USER" -- \
    /usr/bin/env "HOME=$app_home" "USER=$APP_USER" "LOGNAME=$APP_USER" \
      /usr/bin/node --import tsx "$CODE_DIR/scripts/verify-backup.ts"
}

verify_from_image() {
  local image configured_image digest backup_dir run_uid run_gid env_run

  [ -x "$DOCKER" ] || fail "no se encuentra Docker en $DOCKER"
  image="$("$DOCKER" inspect --format '{{.Config.Image}}' \
    "${WANDERBIBLIOTHEK_CONTAINER:-wanderbibliothek}" 2>/dev/null)" ||
    fail "no se pudo inspeccionar el contenedor activo"
  configured_image="${WANDERBIBLIOTHEK_IMAGE:-}"
  [ "$image" = "$configured_image" ] ||
    fail "la imagen del contenedor activo no coincide con image.env"
  [[ "$image" == *@sha256:* ]] || fail "la imagen no está fijada por digest"
  digest="${image##*@sha256:}"
  [[ "$digest" =~ ^[[:xdigit:]]{64}$ ]] || fail "el digest de la imagen no es válido"

  backup_dir="${WANDERBIBLIOTHEK_HOST_BACKUPS:-${WANDERBIBLIOTHEK_BACKUP_DIR:-/var/backups/wanderbibliothek}}"
  [ -d "$backup_dir" ] || fail "no existe el directorio de copias: $backup_dir"
  validate_backup_key "${WANDERBIBLIOTHEK_BACKUP_KEY:-}" ||
    fail "falta WANDERBIBLIOTHEK_BACKUP_KEY; no se puede descifrar la copia"
  run_uid="${WANDERBIBLIOTHEK_RUN_UID:-$(id -u "$APP_USER")}"
  run_gid="${WANDERBIBLIOTHEK_RUN_GID:-$(id -g "$APP_USER")}"
  [[ "$run_uid" =~ ^[0-9]+$ && "$run_gid" =~ ^[0-9]+$ ]] ||
    fail "los UID/GID del contenedor no son válidos"

  env_run="${WANDERBIBLIOTHEK_VERIFY_RUN_ENV:-/run/wanderbibliothek-verify/env}"
  install -d -m 700 "$(dirname "$env_run")"
  umask 077
  : > "$env_run"
  chmod 600 "$env_run"
  VERIFY_ENV_FILE="$env_run"
  printf 'WANDERBIBLIOTHEK_BACKUP_KEY=%s\n' "$WANDERBIBLIOTHEK_BACKUP_KEY" >> "$env_run"

  "$DOCKER" run --rm --init --name wanderbibliothek-verify \
    --network none \
    --read-only \
    --env-file "$env_run" \
    -e WANDERBIBLIOTHEK_DB=/tmp/verify.db \
    -e WANDERBIBLIOTHEK_BACKUP_DIR=/backups \
    -e NODE_OPTIONS=--max-old-space-size=1024 \
    -e TZ=Europe/Berlin \
    -v "$backup_dir:/backups:ro" \
    --user "$run_uid:$run_gid" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 128 \
    --memory 1500m \
    --memory-swap 1500m \
    --tmpfs /tmp:rw,noexec,nosuid,size=256m \
    --entrypoint node \
    "$image" --import tsx /app/scripts/verify-backup.ts
}

case "$APP_EXEC_START" in
  *"/usr/local/sbin/wanderbibliothek-container"*) verify_from_image ;;
  *) verify_from_code ;;
esac
