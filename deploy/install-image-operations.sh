#!/usr/bin/env bash
#
# Desacopla las tareas del host de /srv/wanderbibliothek/current en modo imagen.
set -euo pipefail

fail() { printf 'FALLO: %s\n' "$*" >&2; exit 1; }
ok() { printf 'OK: %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || fail "hay que ejecutarlo como root"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/wanderbibliothek}"
SERVICE_FILE=/etc/systemd/system/wanderbibliothek.service
HARDENING_DIR=/etc/systemd/system/wanderbibliothek.service.d
HARDENING_FILE=$HARDENING_DIR/hardening.conf
STAMP="$(date -u +%Y%m%dT%H%M%S%N)"
BACKUP_SUFFIX=".pre-image-operations-$STAMP"

for source in run-container.sh run-backup-container.sh deploy-image.sh watchdog.sh backup-key.sh \
  nginx-image-assets.awk \
  wanderbibliothek-image.service wanderbibliothek-hardening-image.conf \
  wanderbibliothek-backup.service wanderbibliothek-backup.timer \
  wanderbibliothek-watchdog.service wanderbibliothek-watchdog.timer \
  wanderbibliothek-maintenance.service wanderbibliothek-maintenance.timer; do
  [ -f "$SCRIPT_DIR/$source" ] || fail "falta $SCRIPT_DIR/$source"
done

APP_EXEC_START="$(systemctl show --property=ExecStart --value wanderbibliothek.service)" ||
  fail "no se pudo inspeccionar wanderbibliothek.service"
case "$APP_EXEC_START" in
  *"/usr/local/sbin/wanderbibliothek-container"*) ;;
  *) fail "wanderbibliothek.service no está ejecutando el modo imagen" ;;
esac

[ -f /etc/wanderbibliothek/image.env ] ||
  fail "no existe /etc/wanderbibliothek/image.env"
grep -qE '^WANDERBIBLIOTHEK_IMAGE=.+@sha256:[[:xdigit:]]{64}$' \
  /etc/wanderbibliothek/image.env ||
  fail "image.env no contiene una referencia de imagen fijada por digest"
[ -f "$SERVICE_FILE" ] || fail "no existe $SERVICE_FILE"
[ -f "$HARDENING_FILE" ] || fail "no existe $HARDENING_FILE"
[ -f "$NGINX_SITE" ] || fail "no existe el vhost de nginx en $NGINX_SITE"
command -v nginx >/dev/null 2>&1 || fail "no se encuentra nginx"
command -v curl >/dev/null 2>&1 || fail "no se encuentra curl"

backup_file() {
  local file="$1"
  cp -a "$file" "$file$BACKUP_SUFFIX"
  ok "copia de seguridad: $file$BACKUP_SUFFIX"
}

backup_file "$NGINX_SITE"
backup_file "$SERVICE_FILE"
backup_file "$HARDENING_FILE"
for unit in wanderbibliothek-backup.service wanderbibliothek-backup.timer \
  wanderbibliothek-watchdog.service wanderbibliothek-watchdog.timer \
  wanderbibliothek-maintenance.service wanderbibliothek-maintenance.timer; do
  file="/etc/systemd/system/$unit"
  [ ! -e "$file" ] || backup_file "$file"
done
for file in /usr/local/sbin/wanderbibliothek-container \
  /usr/local/sbin/wanderbibliothek-backup \
  /usr/local/sbin/wanderbibliothek-deploy-image \
  /usr/local/sbin/wanderbibliothek-watchdog \
  /usr/local/lib/wanderbibliothek/backup-key.sh; do
  if [ -e "$file" ] || [ -L "$file" ]; then backup_file "$file"; fi
done

nginx_tmp="$(mktemp "${NGINX_SITE}.tmp.XXXXXX")"
if ! awk -f "$SCRIPT_DIR/nginx-image-assets.awk" "$NGINX_SITE" > "$nginx_tmp"; then
  rm -f "$nginx_tmp"
  fail "no se pudieron identificar exactamente los dos bloques de assets en nginx"
fi
chmod --reference="$NGINX_SITE" "$nginx_tmp"
chown --reference="$NGINX_SITE" "$nginx_tmp"
mv "$nginx_tmp" "$NGINX_SITE"

if ! nginx -t; then
  cp -a "$NGINX_SITE$BACKUP_SUFFIX" "$NGINX_SITE"
  fail "nginx no valida; se restauró el vhost anterior"
fi
if ! systemctl reload nginx; then
  cp -a "$NGINX_SITE$BACKUP_SUFFIX" "$NGINX_SITE"
  nginx -t && systemctl reload nginx || true
  fail "no se pudo recargar nginx; se restauró el vhost anterior"
fi
ok "nginx sirve assets desde la imagen activa"

install -d -m 755 /usr/local/sbin /usr/local/lib/wanderbibliothek "$HARDENING_DIR"
install -m 755 "$SCRIPT_DIR/run-container.sh" /usr/local/sbin/wanderbibliothek-container
install -m 755 "$SCRIPT_DIR/run-backup-container.sh" /usr/local/sbin/wanderbibliothek-backup
install -m 755 "$SCRIPT_DIR/deploy-image.sh" /usr/local/sbin/wanderbibliothek-deploy-image
install -m 755 "$SCRIPT_DIR/watchdog.sh" /usr/local/sbin/wanderbibliothek-watchdog
install -m 644 "$SCRIPT_DIR/backup-key.sh" /usr/local/lib/wanderbibliothek/backup-key.sh
install -m 644 "$SCRIPT_DIR/wanderbibliothek-image.service" "$SERVICE_FILE"
install -m 644 "$SCRIPT_DIR/wanderbibliothek-hardening-image.conf" "$HARDENING_FILE"
for unit in wanderbibliothek-backup.service wanderbibliothek-backup.timer \
  wanderbibliothek-watchdog.service wanderbibliothek-watchdog.timer \
  wanderbibliothek-maintenance.service wanderbibliothek-maintenance.timer; do
  install -m 644 "$SCRIPT_DIR/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
restore_path() {
  local file="$1"
  if [ -e "$file$BACKUP_SUFFIX" ] || [ -L "$file$BACKUP_SUFFIX" ]; then
    cp -a "$file$BACKUP_SUFFIX" "$file"
  else
    rm -f -- "$file"
  fi
}
restore_installation() {
  local file
  restore_path "$NGINX_SITE"
  if nginx -t; then
    systemctl reload nginx || printf 'AVISO: no se pudo recargar nginx tras restaurar el vhost\n' >&2
  else
    printf 'AVISO: nginx no valida tras restaurar el vhost\n' >&2
  fi
  for file in "$SERVICE_FILE" "$HARDENING_FILE" \
    /etc/systemd/system/wanderbibliothek-backup.service \
    /etc/systemd/system/wanderbibliothek-backup.timer \
    /etc/systemd/system/wanderbibliothek-watchdog.service \
    /etc/systemd/system/wanderbibliothek-watchdog.timer \
    /etc/systemd/system/wanderbibliothek-maintenance.service \
    /etc/systemd/system/wanderbibliothek-maintenance.timer \
    /usr/local/sbin/wanderbibliothek-container \
    /usr/local/sbin/wanderbibliothek-backup \
    /usr/local/sbin/wanderbibliothek-deploy-image \
    /usr/local/sbin/wanderbibliothek-watchdog \
    /usr/local/lib/wanderbibliothek/backup-key.sh; do
    restore_path "$file"
  done
  systemctl daemon-reload
  systemctl restart wanderbibliothek.service || true
}

effective_protect_system="$(systemctl show --property=ProtectSystem --value wanderbibliothek.service)" ||
  { restore_installation; fail "no se pudo comprobar el hardening efectivo"; }
[ "$effective_protect_system" = strict ] ||
  { restore_installation; fail "la unidad no conserva ProtectSystem=strict"; }

effective_write_paths="$(systemctl show --property=ReadWritePaths --value wanderbibliothek.service)" ||
  { restore_installation; fail "no se pudieron comprobar las rutas escribibles efectivas"; }
case "$effective_write_paths" in
  *"/srv/wanderbibliothek/current"*)
    restore_installation
    fail "otra configuración systemd aún concede escritura a current"
    ;;
  *"/run/wanderbibliothek"*) ;;
  *)
    restore_installation
    fail "la unidad no permite escribir el entorno efímero de Docker"
    ;;
esac

if ! systemctl restart wanderbibliothek.service; then
  restore_installation
  fail "falló el reinicio; se restauró la instalación anterior"
fi

healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
if [ "$healthy" -ne 1 ]; then
  restore_installation
  fail "la salud no respondió; se restauró la instalación anterior"
fi

if ! systemctl enable --now wanderbibliothek-maintenance.timer \
  wanderbibliothek-backup.timer wanderbibliothek-watchdog.timer; then
  fail "el servicio está sano, pero no se pudieron habilitar todos los temporizadores"
fi
ok "servicio sano; backup, watchdog y mantenimiento habilitados"
