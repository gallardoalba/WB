#!/usr/bin/env bash
#
# Simulacro de restauración en un servidor limpio.
#
#   sudo -u wanderbibliothek ./deploy/restore-drill.sh /ruta/copia.db.enc
#
# Hace dos cosas, en este orden:
#   1. Restaura la copia en un directorio vacío y le aplica las migraciones del
#      código actual (`scripts/restore-drill.ts`). Esto no necesita Docker y
#      detecta una copia corrupta, incompleta o de una versión más nueva.
#   2. Si se indica `WANDERBIBLIOTHEK_IMAGE` y `WANDERBIBLIOTHEK_DRILL_ENV`,
#      arranca esa imagen contra la base restaurada en un puerto libre, espera a
#      `/api/health` y comprueba `/api/version`. Es la prueba de que la
#      instalación nueva no solo abre la base: sirve peticiones con ella.
#
# Variables:
#   WANDERBIBLIOTHEK_BACKUP_KEY   obligatoria si la copia está cifrada
#   WANDERBIBLIOTHEK_IMAGE        `repo@sha256:…` para el paso 2 (opcional)
#   WANDERBIBLIOTHEK_DRILL_ENV    env-file plano (KEY=VALOR) para el paso 2
#   WANDERBIBLIOTHEK_DRILL_PORT   puerto local, por defecto 3101
#   WANDERBIBLIOTHEK_KEEP_DRILL   `1` conserva el directorio restaurado
#   CODE_DIR                      código a probar, por defecto el del script
#
# El env-file del paso 2 debe llevar los mismos secretos que producción
# (sobre todo `APP_ENCRYPTION_KEY` y `NEXT_PUBLIC_SITE_URL`): sin ellos el
# arranque no demuestra nada.
set -Eeuo pipefail

fail() { printf 'FALLO: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CODE_DIR="${CODE_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
DOCKER="${DOCKER_BIN:-/usr/bin/docker}"
NAME="wanderbibliothek-restore-drill"
PORT="${WANDERBIBLIOTHEK_DRILL_PORT:-3101}"
KEEP="${WANDERBIBLIOTHEK_KEEP_DRILL:-0}"

[ $# -eq 1 ] || fail "uso: restore-drill.sh <copia.db[.enc]>"
BACKUP="$1"
[ -r "$BACKUP" ] || fail "no se puede leer la copia: $BACKUP"
[ -f "$CODE_DIR/scripts/restore-drill.ts" ] || fail "no existe $CODE_DIR/scripts/restore-drill.ts"

DRILL_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wanderbibliothek-drill-XXXXXX")"
chmod 700 "$DRILL_ROOT"
DATA_DIR="$DRILL_ROOT/data"
mkdir -p "$DRILL_ROOT/backups"

cleanup() {
  if [ -n "${CONTAINER_STARTED:-}" ]; then
    "$DOCKER" rm -f "$NAME" >/dev/null 2>&1 || true
  fi
  if [ "$KEEP" = "1" ]; then
    printf 'Directorio del simulacro conservado: %s\n' "$DRILL_ROOT" >&2
  else
    rm -rf -- "$DRILL_ROOT"
  fi
}
trap cleanup EXIT

printf 'Paso 1: restaurar la copia en un directorio vacío...\n'
( cd "$CODE_DIR" && node --import tsx scripts/restore-drill.ts --target "$DATA_DIR" "$BACKUP" )

IMAGE="${WANDERBIBLIOTHEK_IMAGE:-}"
if [ -z "$IMAGE" ]; then
  printf '\nSin WANDERBIBLIOTHEK_IMAGE: solo se ha probado la base.\n' >&2
  printf 'Para probar el arranque, exporta la imagen y un env-file (ver cabecera).\n' >&2
  exit 0
fi

ENV_FILE="${WANDERBIBLIOTHEK_DRILL_ENV:-}"
[ -n "$ENV_FILE" ] || fail "WANDERBIBLIOTHEK_DRILL_ENV no está definido"
[ -r "$ENV_FILE" ] || fail "no se puede leer el env-file: $ENV_FILE"
[ -x "$DOCKER" ] || fail "no se encuentra Docker en $DOCKER"
[[ "$IMAGE" == *@sha256:* ]] || fail "la imagen debe ir fijada por digest (repo@sha256:…)"

printf '\nPaso 2: arrancar %s contra la base restaurada en 127.0.0.1:%s...\n' "$IMAGE" "$PORT"
"$DOCKER" rm -f "$NAME" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$NAME" --init \
  --env-file "$ENV_FILE" \
  -e WANDERBIBLIOTHEK_DB=/data/wanderbibliothek.db \
  -e WANDERBIBLIOTHEK_BACKUP_DIR=/backups \
  -e NEXT_PUBLIC_SITE_URL="http://127.0.0.1:$PORT" \
  -e APP_IMAGE="$IMAGE" \
  -e NODE_OPTIONS=--max-old-space-size=1024 \
  -e TZ=Europe/Berlin \
  -v "$DATA_DIR:/data" \
  -v "$DRILL_ROOT/backups:/backups" \
  -p "127.0.0.1:$PORT:3000" \
  --user "$(id -u):$(id -g)" \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 256 \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --tmpfs /app/.next/cache:rw,size=64m \
  --read-only \
  "$IMAGE" >/dev/null
CONTAINER_STARTED=1

health=""
for _ in $(seq 1 60); do
  if ! "$DOCKER" inspect --format '{{.State.Running}}' "$NAME" 2>/dev/null | grep -q true; then
    "$DOCKER" logs --tail 40 "$NAME" >&2 || true
    fail "el contenedor se detuvo antes de responder"
  fi
  health="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
  [ -n "$health" ] && break
  sleep 1
done
[ -n "$health" ] || { "$DOCKER" logs --tail 40 "$NAME" >&2 || true; fail "sin respuesta de /api/health"; }

printf 'Salud: %s\n' "$health"
case "$health" in
  *'"status":"ok"'*) ;;
  *) fail "la instancia restaurada no se declara sana" ;;
esac

version="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/version")" ||
  fail "sin respuesta de /api/version"
printf 'Versión: %s\n' "$version"

case "$version" in
  *"${IMAGE#*@}"*) ;;
  *) printf 'Aviso: la imagen publicada no coincide con el digest configurado.\n' >&2 ;;
esac

printf '\nLa copia restaurada arranca y responde con la imagen indicada.\n'
