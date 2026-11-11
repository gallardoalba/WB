#!/bin/sh
# Comprueba desde **fuera** del servidor que el sitio responde.
#
# El vigilante del VPS no sirve para esto: si la máquina se cae, el vigilante se
# cae con ella. Esto se ejecuta en el portátil (o en cualquier otra máquina) y
# avisa en el escritorio cuando el estado cambia, sin repetir el aviso en cada
# pasada. No necesita ninguna cuenta ni servicio externo; para cubrir también
# las horas con el portátil apagado, añade además un monitor externo
# (healthchecks.io, UptimeRobot…) apuntando a la misma URL.
#
#   ./deploy/uptime-check.sh
#   URL=https://otro-dominio/api/health ./deploy/uptime-check.sh
#
# Sale 0 si responde y 1 si no (las unidades lo tratan como aviso, no como
# error: `SuccessExitStatus=0 1`).
set -u

URL="${URL:-https://wanderbibliothek.org/api/health}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/wanderbibliothek"
ESTADO="$STATE_DIR/uptime.state"
LOG="$STATE_DIR/uptime.log"
mkdir -p "$STATE_DIR"

# `curl` ya escribe 000 con `-w` cuando no hay respuesta: no hay que añadir nada
# (con `|| echo 000` salía «000000»).
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL" 2>/dev/null)
[ -n "$code" ] || code=000
ahora=$(date '+%d-%m-%Y %H:%M')
anterior=$(cat "$ESTADO" 2>/dev/null || echo ok)

estado=ok
[ "$code" = "200" ] || estado=caido
printf '%s %s %s\n' "$ahora" "$code" "$estado" >> "$LOG"

if [ "$estado" != "$anterior" ]; then
  if [ "$estado" = "caido" ]; then
    notify-send -u critical "Wanderbibliothek no responde" "HTTP $code · $ahora" 2>/dev/null || true
    echo "CAÍDO $ahora (HTTP $code)"
  else
    notify-send "Wanderbibliothek vuelve a responder" "$ahora" 2>/dev/null || true
    echo "RECUPERADO $ahora"
  fi
  printf '%s' "$estado" > "$ESTADO"
fi

# El registro no crece sin freno (una línea cada 5 min ≈ 105 000/año).
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

[ "$estado" = "ok" ] && exit 0
exit 1
