#!/usr/bin/env bash
#
# Vigilante del servicio: salud, proxy, disco, edad de la última copia y
# caducidad del certificado. Escribe a journal y, si `ERROR_WEBHOOK_URL` está
# definido en `/etc/wanderbibliothek/env`, manda un JSON (Slack, Discord, un
# Worker propio…). Sale 1 si algo va mal, así que `systemctl status` lo deja ver.
#
# Lo lanza `wanderbibliothek-watchdog.timer` cada 15 minutos como root: necesita
# leer el certificado y la carpeta de copias.
set -uo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wanderbibliothek}"
MAX_BACKUP_AGE_H="${MAX_BACKUP_AGE_H:-12}"
MAX_DISK_PCT="${MAX_DISK_PCT:-85}"
MIN_CERT_DAYS="${MIN_CERT_DAYS:-14}"
CERT="${CERT:-/etc/letsencrypt/live/wanderbibliothek.org/cert.pem}"

problemas=()

# 1. ¿Responde y con el proxy bien configurado?
salud=$(curl -fsS --max-time 10 "$HEALTH_URL" 2>/dev/null) ||
  problemas+=("sin respuesta en $HEALTH_URL")
if [ -n "${salud:-}" ]; then
  case "$salud" in
    *'"proxy":"trusted"'*) ;;
    *) problemas+=("TRUST_PROXY no está activo: $salud") ;;
  esac
  case "$salud" in
    *'"status":"ok"'*) ;;
    *) problemas+=("la aplicación no se declara sana: $salud") ;;
  esac
fi

# 2. Disco.
disco=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ -n "$disco" ] && [ "$disco" -gt "$MAX_DISK_PCT" ]; then
  problemas+=("disco al ${disco}% (tope ${MAX_DISK_PCT}%)")
fi

# 3. ¿Hay una copia reciente?
ultima=$(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.db' -o -name '*.db.enc' \) \
  -printf '%T@\n' 2>/dev/null | sort -rn | head -1)
if [ -z "$ultima" ]; then
  problemas+=("no hay copias en $BACKUP_DIR")
else
  edad_h=$(( ( $(date +%s) - ${ultima%%.*} ) / 3600 ))
  if [ "$edad_h" -gt "$MAX_BACKUP_AGE_H" ]; then
    problemas+=("la última copia tiene ${edad_h} h (tope ${MAX_BACKUP_AGE_H} h)")
  fi
fi

# 4. Certificado (certbot renueva solo; esto avisa si deja de hacerlo).
if [ -f "$CERT" ]; then
  fin=$(date -d "$(openssl x509 -enddate -noout -in "$CERT" | cut -d= -f2)" +%s 2>/dev/null)
  if [ -n "${fin:-}" ]; then
    dias=$(( (fin - $(date +%s)) / 86400 ))
    if [ "$dias" -lt "$MIN_CERT_DAYS" ]; then
      problemas+=("el certificado caduca en ${dias} días")
    fi
  else
    problemas+=("no se pudo leer la fecha del certificado")
  fi
fi

if [ ${#problemas[@]} -eq 0 ]; then
  echo "[watchdog] todo en orden"
  exit 0
fi

mensaje=$(printf '%s; ' "${problemas[@]}")
echo "[watchdog] $mensaje" >&2

if [ -n "${ERROR_WEBHOOK_URL:-}" ]; then
  # JSON mínimo, con comillas y saltos escapados, para no romper el cuerpo.
  limpio=$(printf '%s' "$mensaje" | tr -d '\n' | sed 's/\\/\\\\/g; s/"/\\"/g')
  curl -fsS --max-time 10 -H 'content-type: application/json' \
    --data "{\"text\":\"Wanderbibliothek: ${limpio}\"}" \
    "$ERROR_WEBHOOK_URL" >/dev/null 2>&1 ||
    echo "[watchdog] no se pudo enviar el aviso por webhook" >&2
fi

exit 1
