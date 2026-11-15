#!/usr/bin/env bash
#
# Hace la copia con la misma imagen fijada por digest que sirve la web.
# El gancho externo se ejecuta después en el host, como el usuario de la app:
# así puede usar rclone/rsync sin incluir credenciales ni herramientas en la
# imagen.
set -euo pipefail

fail() { printf 'FALLO: %s\n' "$*" >&2; exit 1; }
BACKUP_ENV_FILE=""
cleanup_backup_env() {
  [ -z "$BACKUP_ENV_FILE" ] || rm -f -- "$BACKUP_ENV_FILE"
}
trap cleanup_backup_env EXIT

DOCKER="${DOCKER_BIN:-/usr/bin/docker}"
APP_USER="${WANDERBIBLIOTHEK_USER:-wanderbibliothek}"
CODE_DIR="${WANDERBIBLIOTHEK_CODE_DIR:-/srv/wanderbibliothek/current}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_KEY_LIBRARY=/usr/local/lib/wanderbibliothek/backup-key.sh
if [ ! -r "$BACKUP_KEY_LIBRARY" ]; then BACKUP_KEY_LIBRARY="$SCRIPT_DIR/backup-key.sh"; fi
[ -r "$BACKUP_KEY_LIBRARY" ] || fail "falta el validador de clave de copia"
. "$BACKUP_KEY_LIBRARY"

APP_EXEC_START="$(systemctl show --property=ExecStart --value wanderbibliothek.service)" ||
  fail "no se pudo determinar el modo de despliegue de wanderbibliothek.service"

backup_from_code() {
  local app_home
  [ -f "$CODE_DIR/scripts/backup.ts" ] ||
    fail "no existe el script de copia de código en $CODE_DIR"
  validate_backup_key "${WANDERBIBLIOTHEK_BACKUP_KEY:-}" ||
    fail "falta una clave válida; se rechaza crear una copia sin cifrar"
  command -v runuser >/dev/null 2>&1 || fail "falta runuser para ejecutar la copia como $APP_USER"
  getent passwd "$APP_USER" >/dev/null || fail "no existe el usuario $APP_USER"
  app_home="$(getent passwd "$APP_USER" | cut -d: -f6)"
  cd "$CODE_DIR"
  exec runuser --preserve-environment --user "$APP_USER" -- \
    /usr/bin/env "HOME=$app_home" "USER=$APP_USER" "LOGNAME=$APP_USER" \
      /usr/bin/node --import tsx "$CODE_DIR/scripts/backup.ts"
}

backup_from_image() {
  local image configured_image digest data_dir backup_dir run_uid run_gid env_run output result backup_file

  [ -x "$DOCKER" ] || fail "no se encuentra Docker en $DOCKER"
  image="$("$DOCKER" inspect --format '{{.Config.Image}}' \
    "${WANDERBIBLIOTHEK_CONTAINER:-wanderbibliothek}" 2>/dev/null)" ||
    fail "no se pudo inspeccionar el contenedor activo"
  configured_image="${WANDERBIBLIOTHEK_IMAGE:-}"
  [ "$image" = "$configured_image" ] ||
    fail "la imagen del contenedor activo no coincide con image.env; no se ejecuta una copia con otro código"
  [[ "$image" == *@sha256:* ]] || fail "la imagen no está fijada por digest"
  digest="${image##*@sha256:}"
  [[ "$digest" =~ ^[[:xdigit:]]{64}$ ]] || fail "el digest de la imagen no es válido"

  data_dir="${WANDERBIBLIOTHEK_HOST_DATA:-/var/lib/wanderbibliothek}"
  backup_dir="${WANDERBIBLIOTHEK_HOST_BACKUPS:-${WANDERBIBLIOTHEK_BACKUP_DIR:-/var/backups/wanderbibliothek}}"
  run_uid="${WANDERBIBLIOTHEK_RUN_UID:-$(id -u "$APP_USER")}"
  run_gid="${WANDERBIBLIOTHEK_RUN_GID:-$(id -g "$APP_USER")}"

  [[ "$run_uid" =~ ^[0-9]+$ && "$run_gid" =~ ^[0-9]+$ ]] ||
    fail "los UID/GID del contenedor no son válidos"
  [ -f "$data_dir/wanderbibliothek.db" ] ||
    fail "no existe la base de datos en $data_dir/wanderbibliothek.db"
  validate_backup_key "${WANDERBIBLIOTHEK_BACKUP_KEY:-}" ||
    fail "falta WANDERBIBLIOTHEK_BACKUP_KEY; se rechaza crear una copia sin cifrar"

  for key in WANDERBIBLIOTHEK_BACKUP_KEEP WANDERBIBLIOTHEK_COVERS_KEEP; do
    value="${!key:-}"
    if [ -n "$value" ] && [[ ! "$value" =~ ^[0-9]+$ ]]; then
      fail "$key debe ser un entero"
    fi
  done

  install -d -m 700 -o "$run_uid" -g "$run_gid" "$backup_dir"
  env_run="${WANDERBIBLIOTHEK_BACKUP_RUN_ENV:-/run/wanderbibliothek-backup/env}"
  install -d -m 700 "$(dirname "$env_run")"
  umask 077
  : > "$env_run"
  chmod 600 "$env_run"
  BACKUP_ENV_FILE="$env_run"
  printf 'WANDERBIBLIOTHEK_BACKUP_KEY=%s\n' "$WANDERBIBLIOTHEK_BACKUP_KEY" >> "$env_run"
  if [ -n "${WANDERBIBLIOTHEK_BACKUP_KEEP:-}" ]; then
    printf 'WANDERBIBLIOTHEK_BACKUP_KEEP=%s\n' "$WANDERBIBLIOTHEK_BACKUP_KEEP" >> "$env_run"
  fi
  if [ -n "${WANDERBIBLIOTHEK_COVERS_KEEP:-}" ]; then
    printf 'WANDERBIBLIOTHEK_COVERS_KEEP=%s\n' "$WANDERBIBLIOTHEK_COVERS_KEEP" >> "$env_run"
  fi

  if ! output="$("$DOCKER" run --rm --init --name wanderbibliothek-backup \
    --network none \
    --read-only \
    --env-file "$env_run" \
    -e WANDERBIBLIOTHEK_DB=/data/wanderbibliothek.db \
    -e WANDERBIBLIOTHEK_BACKUP_DIR=/backups \
    -e WANDERBIBLIOTHEK_BACKUP_HOOK= \
    -e NODE_OPTIONS=--max-old-space-size=1024 \
    -e TZ=Europe/Berlin \
    -v "$data_dir:/data" \
    -v "$backup_dir:/backups" \
    --user "$run_uid:$run_gid" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 128 \
    --memory 1500m \
    --memory-swap 1500m \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --entrypoint node \
    "$image" --import tsx /app/scripts/backup.ts 2>&1)"; then
    printf '%s\n' "$output" >&2
    fail "falló la copia ejecutada desde la imagen $image"
  fi
  printf '%s\n' "$output"

  result="$(printf '%s\n' "$output" | sed -n 's/^WANDERBIBLIOTHEK_BACKUP_RESULT=//p')"
  [[ "$result" =~ ^wanderbibliothek-.*\.db(\.enc)?$ ]] ||
    fail "la imagen no informó el fichero de copia creado"
  [[ "$result" != */* ]] || fail "el resultado de copia no es un nombre de fichero"
  backup_file="$backup_dir/$result"
  [ -s "$backup_file" ] && [ ! -L "$backup_file" ] ||
    fail "no se encuentra el fichero de copia creado: $backup_file"

  if [ -n "${WANDERBIBLIOTHEK_BACKUP_HOOK:-}" ]; then
    local hook_record hook_user hook_home
    hook_record="$(getent passwd "$run_uid")"
    [ -n "$hook_record" ] || fail "no existe el usuario con UID $run_uid para ejecutar el gancho"
    hook_user="$(printf '%s' "$hook_record" | cut -d: -f1)"
    hook_home="$(printf '%s' "$hook_record" | cut -d: -f6)"
    runuser --user "$hook_user" -- \
      /usr/bin/env -i \
        PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
        "HOME=$hook_home" "USER=$hook_user" "LOGNAME=$hook_user" \
        "BACKUP_FILE=$backup_file" /bin/sh -c "$WANDERBIBLIOTHEK_BACKUP_HOOK" ||
      fail "falló el gancho de copia externa"
  fi
}

case "$APP_EXEC_START" in
  *"/usr/local/sbin/wanderbibliothek-container"*) backup_from_image ;;
  *"/srv/wanderbibliothek/current/node_modules/next/dist/bin/next"*) backup_from_code ;;
  *) fail "modo de despliegue no reconocido en wanderbibliothek.service" ;;
esac
