#!/usr/bin/env bash
#
# Arranca Wanderbibliothek como contenedor. Lo invoca la unidad de systemd
# (`wanderbibliothek.service`) y no se ejecuta a mano en producción.
#
# La imagen va fijada por **digest** en `/etc/wanderbibliothek/image.env`; este
# script solo monta los datos del host, pasa el entorno y arranca. El digest se
# publica en `/api/version` como `image`, que es lo que permite verificarlo con
# `cosign verify`.
#
# Variables (las escribe `deploy/deploy-image.sh`):
#   WANDERBIBLIOTHEK_IMAGE        referencia `repo@sha256:…` (obligatoria)
#   WANDERBIBLIOTHEK_RUN_UID/GID  usuario del host dueño de los datos
#   WANDERBIBLIOTHEK_HOST_DATA    carpeta con la base y las portadas
#   WANDERBIBLIOTHEK_HOST_BACKUPS carpeta de copias
#   WANDERBIBLIOTHEK_HOST_CACHE   caché de Next (escribible por ese usuario)
set -euo pipefail

: "${WANDERBIBLIOTHEK_IMAGE:?falta WANDERBIBLIOTHEK_IMAGE (ver /etc/wanderbibliothek/image.env)}"

DOCKER="${DOCKER_BIN:-/usr/bin/docker}"
CONTAINER="${WANDERBIBLIOTHEK_CONTAINER:-wanderbibliothek}"
DATA_DIR="${WANDERBIBLIOTHEK_HOST_DATA:-/var/lib/wanderbibliothek}"
BACKUP_DIR="${WANDERBIBLIOTHEK_HOST_BACKUPS:-/var/backups/wanderbibliothek}"
CACHE_DIR="${WANDERBIBLIOTHEK_HOST_CACHE:-$DATA_DIR/next-cache}"
RUN_UID="${WANDERBIBLIOTHEK_RUN_UID:-999}"
RUN_GID="${WANDERBIBLIOTHEK_RUN_GID:-988}"
PORT="${WANDERBIBLIOTHEK_PORT:-127.0.0.1:3000}"

# Docker **no** interpreta las comillas del fichero de entorno: las deja
# literales (`MAIL_FROM="Nombre <correo>"`), mientras que systemd sí las quita.
# Eso rompía el arranque (`parseSender`) y habría publicado las comillas de
# LEGAL_* en las páginas legales. Se reconstruye el env-file con los valores ya
# parseados por systemd, es decir, los mismos que veía el proceso del host.
ENV_RUN="${WANDERBIBLIOTHEK_RUN_ENV:-/run/wanderbibliothek/env}"
install -d -m 700 "$(dirname "$ENV_RUN")"
umask 077
: > "$ENV_RUN"
while IFS= read -r key; do
  if [ -n "${!key+x}" ]; then printf '%s=%s\n' "$key" "${!key}" >> "$ENV_RUN"; fi
done < <(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' /etc/wanderbibliothek/env 2>/dev/null)

# Si un arranque anterior dejó el contenedor con el mismo nombre, se retira:
# systemd ya paró el cliente y un choque de nombre impediría arrancar.
"$DOCKER" rm -f "$CONTAINER" >/dev/null 2>&1 || true

exec "$DOCKER" run --rm --name "$CONTAINER" --init \
  --env-file "$ENV_RUN" \
  -e WANDERBIBLIOTHEK_DB=/data/wanderbibliothek.db \
  -e WANDERBIBLIOTHEK_BACKUP_DIR=/backups \
  -e APP_IMAGE="$WANDERBIBLIOTHEK_IMAGE" \
  -e NODE_OPTIONS=--max-old-space-size=1024 \
  -e TZ=Europe/Berlin \
  -v "$DATA_DIR:/data" \
  -v "$BACKUP_DIR:/backups" \
  -v "$CACHE_DIR:/app/.next/cache" \
  -p "$PORT:3000" \
  --user "$RUN_UID:$RUN_GID" \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 256 \
  --memory 1500m \
  --memory-swap 1500m \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  --stop-timeout 30 \
  "$WANDERBIBLIOTHEK_IMAGE"
