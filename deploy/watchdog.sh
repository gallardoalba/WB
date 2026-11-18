#!/usr/bin/env bash
#
# Vigilante del servicio: salud, proxy, cola de correo, WAL, tasa de errores,
# disco, edad de la última copia y caducidad del certificado. Escribe a journal
# y, si `ERROR_WEBHOOK_URL` está definido en `/etc/wanderbibliothek/env`, manda
# un JSON (Slack, Discord, un Worker propio…). Sale 1 si algo va mal, así que
# `systemctl status` lo deja ver.
#
# Lo lanza `wanderbibliothek-watchdog.timer` cada 15 minutos como root: necesita
# leer el certificado y la carpeta de copias.
set -uo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
BACKUP_DIR="${BACKUP_DIR:-${WANDERBIBLIOTHEK_HOST_BACKUPS:-${WANDERBIBLIOTHEK_BACKUP_DIR:-/var/backups/wanderbibliothek}}}"
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

# 2. Cola de correo, WAL y tasa de errores.
#
#   Se piden en formato Prometheus y se leen con `awk`: son dos líneas en vez de
#   un analizador de JSON en shell, y el formato es estable. El token es el del
#   mantenimiento, que es lo único que tiene el host, y el endpoint no lleva
#   contenido de nadie.
#
#   Lo que se vigila aquí es lo que la sonda de salud no ve: un correo que se
#   dio por perdido (nadie recibe su enlace de verificación y no hay error en
#   ninguna parte), una cola que no avanza, un WAL que crece porque el
#   checkpoint no completa, y una proporción de errores que ya no es un caso
#   aislado.
METRICS_URL="${METRICS_URL:-http://127.0.0.1:3000/api/metrics?format=prometheus}"
MAX_MAIL_FAILED="${MAX_MAIL_FAILED:-0}"
MAX_MAIL_WAIT_MIN="${MAX_MAIL_WAIT_MIN:-120}"
MAX_WAL_MB="${MAX_WAL_MB:-512}"
MAX_ERROR_PCT="${MAX_ERROR_PCT:-5}"
MIN_REQUESTS_ERRORS="${MIN_REQUESTS_ERRORS:-50}"

metricas=""
if [ -n "${MAINTENANCE_TOKEN:-}" ]; then
  metricas=$(curl -fsS --max-time 8 -H "Authorization: Bearer $MAINTENANCE_TOKEN" "$METRICS_URL" 2>/dev/null) || true
fi

# Valor de una serie; vacío si la métrica no está (instancia sin esta versión).
metrica() {
  printf '%s\n' "$metricas" | awk -v serie="$1" '$1 == serie { print $2; exit }'
}

# Parte entera de un valor de Prometheus, o vacío si no es un número: un cambio
# de formato no puede convertir el vigilante en un generador de avisos falsos.
entero() {
  case "${1%.*}" in
    '' | *[!0-9]*) printf '' ;;
    *) printf '%s' "${1%.*}" ;;
  esac
}

if [ -z "${MAINTENANCE_TOKEN:-}" ]; then
  echo "[watchdog] sin MAINTENANCE_TOKEN no se revisan cola, WAL ni errores" >&2
elif [ -z "$metricas" ]; then
  problemas+=("no se pudieron leer las métricas en $METRICS_URL")
else
  perdidos=$(entero "$(metrica 'wanderbibliothek_jobs_failed_24h{kind=\"mail\"}')")
  fallidos=$(entero "$(metrica 'wanderbibliothek_jobs{kind=\"mail\",status=\"failed\"}')")
  espera=$(entero "$(metrica 'wanderbibliothek_jobs_oldest_pending_minutes{kind=\"mail\"}')")
  wal=$(entero "$(metrica 'wanderbibliothek_database_wal_bytes')")
  peticiones=$(entero "$(metrica 'wanderbibliothek_http_requests_total')")
  errores=$(entero "$(metrica 'wanderbibliothek_http_errors_total')")

  if [ -n "$perdidos" ] && [ "$perdidos" -gt 0 ]; then
    problemas+=("$perdidos correo(s) dados por perdidos en 24 h")
  fi
  if [ -n "$fallidos" ] && [ "$fallidos" -gt "$MAX_MAIL_FAILED" ]; then
    problemas+=("$fallidos correo(s) en estado fallido")
  fi
  if [ -n "$espera" ] && [ "$espera" -gt "$MAX_MAIL_WAIT_MIN" ]; then
    problemas+=("el correo pendiente más antiguo espera $espera min (tope $MAX_MAIL_WAIT_MIN)")
  fi
  if [ -n "$wal" ] && [ "$(( wal / 1048576 ))" -gt "$MAX_WAL_MB" ]; then
    problemas+=("el WAL ocupa $(( wal / 1048576 )) MB (tope $MAX_WAL_MB MB): el checkpoint no completa")
  fi
  if [ -n "$peticiones" ] && [ -n "$errores" ] &&
     [ "$peticiones" -ge "$MIN_REQUESTS_ERRORS" ] &&
     [ "$(( errores * 100 / peticiones ))" -gt "$MAX_ERROR_PCT" ]; then
    problemas+=("$(( errores * 100 / peticiones ))% de errores sobre $peticiones peticiones")
  fi
fi

# 3. Disco.
disco=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ -n "$disco" ] && [ "$disco" -gt "$MAX_DISK_PCT" ]; then
  problemas+=("disco al ${disco}% (tope ${MAX_DISK_PCT}%)")
fi

# 4. ¿Hay una copia reciente?
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

# 5. Certificado (certbot renueva solo; esto avisa si deja de hacerlo).
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

# 6. Serie histórica (una línea por pasada; se recorta sola).
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

# 7. Dead-man's switch: si este script deja de ejecutarse, el monitor externo
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
