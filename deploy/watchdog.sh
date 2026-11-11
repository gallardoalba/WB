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
# Serie histórica: sin ella no se ve una fuga de memoria ni el crecimiento del
# disco hasta que duele. Una línea por pasada (cada 15 min).
METRICS_CSV="${METRICS_CSV:-/var/lib/wanderbibliothek/watchdog.csv}"
MAX_METRICS_LINES="${MAX_METRICS_LINES:-20000}"

problemas=()
edad_copia=-1
dias_cert=-1
http_code=0
ttfb_ms=0

# 1. ¿Responde y con el proxy bien configurado?
#   La última línea del cuerpo (que se recorta) lleva código y tiempo para la
#   serie histórica; los checks siguen mirando el JSON de arriba.
salud=$(curl -fsS --max-time 10 -w '\nHTTP %{http_code} %{time_total}' "$HEALTH_URL" 2>/dev/null) || true
if [ -n "${salud:-}" ]; then
  medida=$(printf '%s' "$salud" | tail -1)
  http_code=$(printf '%s' "$medida" | awk '{print $2}')
  # `LC_ALL=C`: con locale alemán awk lee «0.003» como cero (coma decimal).
  ttfb_ms=$(printf '%s' "$medida" | LC_ALL=C awk '{printf "%.0f", $3 * 1000}')
  salud=$(printf '%s' "$salud" | sed '$d')
else
  http_code=000
fi
http_code=${http_code:-000}
ttfb_ms=${ttfb_ms:-0}

if [ -z "${salud:-}" ]; then
  problemas+=("sin respuesta en $HEALTH_URL")
fi
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
  edad_copia=$edad_h
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
    dias_cert=$dias
  else
    problemas+=("no se pudo leer la fecha del certificado")
  fi
fi

# 5. Serie histórica (una línea por pasada; se recorta sola).
ram_mb=$(free -m | awk '/^Mem:/ {print $3}')
estado=ok
[ ${#problemas[@]} -gt 0 ] && estado=fail
if [ ! -s "$METRICS_CSV" ]; then
  printf 'fecha,http,ttfb_ms,disco_pct,ram_mb,copia_h,cert_dias,estado\n' >> "$METRICS_CSV" 2>/dev/null || true
fi
printf '%s,%s,%s,%s,%s,%s,%s,%s\n' \
  "$(date -u +%FT%TZ)" "$http_code" "$ttfb_ms" "${disco:-0}" "${ram_mb:-0}" \
  "$edad_copia" "$dias_cert" "$estado" >> "$METRICS_CSV" 2>/dev/null || true
if [ -f "$METRICS_CSV" ] && [ "$(wc -l < "$METRICS_CSV")" -gt "$MAX_METRICS_LINES" ]; then
  tail -n "$MAX_METRICS_LINES" "$METRICS_CSV" > "$METRICS_CSV.tmp" && mv "$METRICS_CSV.tmp" "$METRICS_CSV"
fi

# 6. Dead-man's switch: si este script deja de ejecutarse, el monitor externo
#    lo nota. La URL es de healthchecks.io o compatible (una por vigilante).
if [ -n "${WATCHDOG_PING_URL:-}" ]; then
  destino="$WATCHDOG_PING_URL"
  [ "$estado" = "fail" ] && destino="$WATCHDOG_PING_URL/fail"
  curl -fsS --max-time 8 -o /dev/null "$destino" 2>/dev/null ||
    echo "[watchdog] no se pudo avisar al monitor externo" >&2
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
