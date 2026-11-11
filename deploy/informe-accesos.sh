#!/usr/bin/env bash
#
# Informe de intentos de acceso y ataques del servidor, lanzado desde el portátil.
#
# Lee en el VPS (solo lectura) el journal de ssh, los logs de nginx y de
# fail2ban, y la base de datos, y compone el informe que hasta ahora se hacía a
# mano con grep. No escribe nada ni provoca límites de nginx, así que no puede
# autobanearse.
#
#   ./deploy/informe-accesos.sh              # hoy (día en curso)
#   ./deploy/informe-accesos.sh --ayer       # el día anterior
#   ./deploy/informe-accesos.sh --dias 3     # de hace tres días
#   ./deploy/informe-accesos.sh --json       # una línea JSON para cron/alertas
#
# Sale 1 si hay algo que mirar (5xx, contraseña aceptada por SSH, health != 200,
# fail2ban sin baneos habiendo fallos), para poder usarlo en un cron.
#
# Variables:
#   WB_HOST      alias ssh del servidor (por defecto `wanderbibliothek`)
#   WB_EXCLUIR   IPs que nunca cuentan como atacantes, separadas por comas
#
# Ojo: el «día» es el del servidor (Europe/Berlin), y las rotaciones de nginx y
# de fail2ban son a medianoche. Las cuentas nuevas se cuentan por la fecha UTC
# de `users.created_at`, que es como se guarda.
set -uo pipefail

HOST="${WB_HOST:-wanderbibliothek}"
DIAS=0
FORMATO=texto

uso() {
  cat <<'AYUDA'
Uso: deploy/informe-accesos.sh [opciones]

  -d, --dias N   día a informar: 0 = hoy (defecto), 1 = ayer, 2 = anteayer…
      --ayer     atajo de --dias 1
      --json     salida JSON de una línea, para cron o para un webhook
  -h, --help     esta ayuda

Variables de entorno:
  WB_HOST        alias ssh del servidor (defecto: wanderbibliothek)
  WB_EXCLUIR     IPs que nunca cuentan como atacantes, separadas por comas
                 (las IPs con acceso SSH correcto se excluyen solas)
AYUDA
}

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dias)
      [ $# -ge 2 ] || { echo "Falta el número de días." >&2; exit 2; }
      DIAS="$2"; shift 2 ;;
    --ayer) DIAS=1; shift ;;
    --json) FORMATO=json; shift ;;
    -h|--help) uso; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; uso >&2; exit 2 ;;
  esac
done

case "$DIAS" in
  ''|*[!0-9]*) echo "Los días tienen que ser un número entero (0 = hoy)." >&2; exit 2 ;;
esac

EXCLUIR="${WB_EXCLUIR:-}"
case "$EXCLUIR" in
  *[!0-9a-fA-F.:,]*) echo "WB_EXCLUIR solo admite IPs separadas por comas." >&2; exit 2 ;;
esac

ssh -o ConnectTimeout=15 -o BatchMode=yes "$HOST" \
  "DIAS=$DIAS FORMATO=$FORMATO EXCLUIR=$EXCLUIR bash -s" <<'REMOTE'
set -uo pipefail

# --- Ventana ---------------------------------------------------------------
DESDE="$(date -d "-${DIAS} day" +%F)"
HASTA="$(date -d "$DESDE +1 day" +%F)"
# nginx escribe los meses en inglés pase lo que pase con el locale del sistema.
ETIQUETA="$(LC_ALL=C date -d "$DESDE" +%d/%b/%Y)"
SERVIDOR="$(hostname)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# `grep -c` siempre imprime una cifra, pero sale 1 cuando no casa y 2 si el
# fichero no existe; así el recuento nunca queda vacío ni duplicado.
n() { local v; v=$(grep -c "$@" 2>/dev/null); printf '%d' "${v:-0}"; }

# --- Recogida de datos (todos los ficheros rotados, filtrados por fecha) ----
journalctl -u ssh --since "$DESDE 00:00:00" --until "$HASTA 00:00:00" \
  --no-pager 2>/dev/null > "$TMP/ssh.log" || : true

: > "$TMP/f2b.log"
for f in /var/log/fail2ban.log /var/log/fail2ban.log.1 /var/log/fail2ban.log.2.gz \
         /var/log/fail2ban.log.3.gz /var/log/fail2ban.log.4.gz; do
  [ -e "$f" ] || continue
  case "$f" in
    *.gz) zgrep -hE "^${DESDE} " "$f" ;;
    *)    grep  -hE "^${DESDE} " "$f" ;;
  esac
done >> "$TMP/f2b.log" 2>/dev/null

: > "$TMP/web.log"
for f in /var/log/nginx/wanderbibliothek.access.log{,.1,.2.gz,.3.gz,.4.gz}; do
  [ -e "$f" ] || continue
  case "$f" in
    *.gz) zgrep -hF "$ETIQUETA" "$f" ;;
    *)    grep  -hF "$ETIQUETA" "$f" ;;
  esac
done >> "$TMP/web.log" 2>/dev/null

: > "$TMP/ip.log"
for f in /var/log/nginx/access.log{,.1,.2.gz,.3.gz,.4.gz}; do
  [ -e "$f" ] || continue
  case "$f" in
    *.gz) zgrep -hF "$ETIQUETA" "$f" ;;
    *)    grep  -hF "$ETIQUETA" "$f" ;;
  esac
done >> "$TMP/ip.log" 2>/dev/null

# --- SSH -------------------------------------------------------------------
grep -E "Invalid user|Failed password|Connection closed by authenticating user|Connection closed by [0-9a-f.:]+ port|banner exchange|kex_exchange_identification|Did not receive identification|maximum authentication attempts" \
  "$TMP/ssh.log" > "$TMP/ssh_fallos.log" 2>/dev/null || : true

# IPs que sí entraron con clave: no son atacantes (el usuario, y este informe).
grep -oE "Accepted (publickey|password) for [^ ]+ from [0-9a-f.:]+" "$TMP/ssh.log" 2>/dev/null \
  | awk '{print $NF}' | sort -u > "$TMP/aceptadas.txt"
ACEPTADOS_EVENTOS=$(n "Accepted " "$TMP/ssh.log")
ACEPTADOS_IPS=$(n . "$TMP/aceptadas.txt")
CONTRASENA_ACEPTADA=$(n "Accepted password" "$TMP/ssh.log")

# Lista de exclusión: las que entraron + WB_EXCLUIR.
{ cat "$TMP/aceptadas.txt"; printf '%s' "$EXCLUIR" | tr ',' '\n'; } \
  | sed '/^[[:space:]]*$/d' | sort -u > "$TMP/excluir.txt"

excluir() {
  if [ -s "$TMP/excluir.txt" ]; then grep -vxF -f "$TMP/excluir.txt"; else cat; fi
}

# fail2ban es la fuente fiable de «cuántos intentos» (cuenta líneas del journal);
# si el jail está parado, se usa el recuento directo del journal.
FALLOS=$(n "\[sshd\] Found" "$TMP/f2b.log")
[ "$FALLOS" -eq 0 ] && FALLOS=$(n . "$TMP/ssh_fallos.log")

IP_ATACANTES=$(grep -oE "([0-9]{1,3}\.){3}[0-9]{1,3}" "$TMP/ssh_fallos.log" 2>/dev/null \
  | excluir | sort -u)
IPS_SSH=$(printf '%s\n' "$IP_ATACANTES" | n .)

USUARIOS=$(grep -oiE "invalid user [^ ,]+|authenticating user [^ ,]+" "$TMP/ssh_fallos.log" 2>/dev/null \
  | awk '{print $3}' | sort -u)
USUARIOS_N=$(printf '%s\n' "$USUARIOS" | n .)

TOP_SSH=$(grep -oE "([0-9]{1,3}\.){3}[0-9]{1,3}" "$TMP/ssh_fallos.log" 2>/dev/null \
  | excluir | sort | uniq -c | sort -rn | head -5 \
  | awk '{printf "%s%s (%s)", s, $2, $1; s=", "}')

ULTIMO_SSH=$(grep -E "Invalid user|Failed password|Connection closed|banner exchange" "$TMP/ssh_fallos.log" 2>/dev/null \
  | tail -1 | sed -E 's/^[A-Z][a-z]{2} +[0-9]+ [0-9:]+ [^ ]+ sshd[^:]*: //; s/ port [0-9]+.*$//' \
  | tr -s ' ')

banes_jail() { n -E "\[$1\] Ban [0-9a-f.:]+ *$" "$TMP/f2b.log"; }
prorrogas() { n -E "\[$1\] Increase Ban" "$TMP/f2b.log"; }
BAN_SSHD=$(banes_jail sshd)
BAN_SCAN=$(banes_jail wb-nginx-scan)
BAN_LIMIT=$(banes_jail wb-nginx-limit)
PRO_SSHD=$(prorrogas sshd)
PRO_SCAN=$(prorrogas wb-nginx-scan)

baneados_ahora() {
  fail2ban-client status "$1" 2>/dev/null \
    | sed -n 's/.*Banned IP list:[[:space:]]*//p' | tr -s ' ' '\n' | n .
}
AHORA_SSHD=$(baneados_ahora sshd)
AHORA_SCAN=$(baneados_ahora wb-nginx-scan)
AHORA_LIMIT=$(baneados_ahora wb-nginx-limit)

# --- Web -------------------------------------------------------------------
VHOST_N=$(n . "$TMP/web.log")
IPN_N=$(n . "$TMP/ip.log")
WEB_N=$(( VHOST_N + IPN_N ))

leer_codigos() { # "2xx 3xx 4xx 5xx"
  cat "$@" 2>/dev/null | awk '$9 ~ /^[2-5][0-9][0-9]$/ {
      if ($9 < 300) a++; else if ($9 < 400) b++; else if ($9 < 500) c++; else d++
    } END { printf "%d %d %d %d", a, b, c, d }'
}
read -r C2 C3 C4 C5 <<< "$(leer_codigos "$TMP/web.log" "$TMP/ip.log")"

# Las líneas de protocolos que no son HTTP (DICOM, Oracle TNS, RTSP…) dejan
# códigos que no existen; se descartan con el rango 2xx-5xx.
CODIGOS=$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null \
  | awk '$9 ~ /^[2-5][0-9][0-9]$/ {c[$9]++} END {for (k in c) print c[k], k}' \
  | sort -rn | head -6 | awk '{printf "%s%s×%s", s, $2, $1; s=" "}')

S444=$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null | awk '$9 == 444' | wc -l)
S429=$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null | awk '$9 == 429' | wc -l)
S403=$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null | awk '$9 == 403' | wc -l)

# Visitas que trajo el bot de Mastodon. El enlace de cada aviso lleva
# `?ref=mastodon` (ver `ANNOUNCE_REF` en `src/lib/mastodon.ts`): así se cuentan
# aunque la app de turno no mande `Referer`. Solo las páginas que abrieron bien
# (2xx) y una vez por IP, que aquí medimos visitas, no aperturas de pestañas.
REF_MAST=$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null \
  | awk '$9 ~ /^2/ && $7 ~ /[?&]ref=mastodon/ {print $1}' | wc -l)
REF_MAST_IPS=$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null \
  | awk '$9 ~ /^2/ && $7 ~ /[?&]ref=mastodon/ {print $1}' | sort -u | wc -l)

# Visitas que llegan **del fediverso** por el `Referer`, que es el otro camino:
# la marca `?ref=` solo existe desde el 11-nov, así que los avisos anteriores
# se reconocen por la instancia o la app de la que salen. Se aceptan las apps
# (esquema `android-app://`), el nombre del software (mastodon, pleroma,
# misskey…) y cualquier host que termine en `.social`, que en la práctica es
# una instancia. Se descartan las peticiones que no son páginas y las IPs de la
# lista de exclusión (las que entran por SSH, o sea, quien lanza el informe).
FEDI_TODO=$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null | awk -v excl="$TMP/excluir.txt" '
  BEGIN { while ((getline l < excl) > 0) if (l != "") fuera[l] = 1 }
  function fedi(r,   s) {
    s = tolower(r)
    if (s ~ /android-app:\/\/org\.joinmastodon/) return 1
    if (s ~ /^"?https?:\/\/[^\/]*\.social/) return 1
    return s ~ /mastodon|mstdn|pleroma|misskey|akkoma|sharkey|firefish|calckey|iceshrimp|friendica|lemmy|pixelfed|bookwyrm|phanpy|elk\.zone|pinafore|todon|fosstodon|hachyderm/
  }
  $11 == "" || $11 == "\"-\"" { next }
  !fedi($11) { next }
  $9 !~ /^[23]/ { next }
  {
    p = $7; sub(/\?.*/, "", p)
    if (p ~ /^\/(_next\/static|fonts\/|icons\/|hero\/|sw\.js|favicon\.ico|manifest\.webmanifest)/) next
    if (fuera[$1]) next
    host = $11; gsub(/^"|"$/, "", host)
    sub(/^android-app:\/\//, "app:", host)
    sub(/^https?:\/\//, "", host)
    sub(/[\/?#].*$/, "", host)
    print $1 "\t" (host == "" ? "app" : host)
  }')
FEDI_PAGS=$(printf '%s\n' "$FEDI_TODO" | n .)
FEDI_IPS=$(printf '%s\n' "$FEDI_TODO" | cut -f1 | sort -u | n .)
FEDI_ORIGEN=$(printf '%s\n' "$FEDI_TODO" | cut -f2 | sed '/^$/d' | sort | uniq -c | sort -rn | head -3 \
  | awk '{printf "%s%s %s", s, $2, $1; s=" · "}')
FEDI_ORIGEN_JSON=$(printf '%s\n' "$FEDI_TODO" | cut -f2 | sed '/^$/d' | sort | uniq -c | sort -rn | head -6 \
  | awk '{printf "%s{\"host\":\"%s\",\"paginas\":%s}", s, $2, $1; s=","}')

read -r P_WP P_PHP P_SEC P_MCP P_ADM P_OTRO <<< "$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null \
  | awk '$9 ~ /^[4-5][0-9][0-9]$/ {
      p = $7
      if (p ~ /wp-|xmlrpc|wordpress/) wp++
      else if (p ~ /\.env|\.git|\.bak|\.sql|\.old|\.swp|DS_Store/) sec++
      else if (p ~ /\.php/) php++
      else if (p ~ /\/mcp/) mcp++
      else if (p ~ /admin|setup\.cgi|config/) adm++
      else otro++
    } END { printf "%d %d %d %d %d %d", wp, php, sec, mcp, adm, otro }')"

CF='^(104\.(1[6-9]|2[0-7])\.|172\.(6[4-9]|7[01])\.|162\.15[89]\.|141\.101\.|108\.162\.|190\.93\.|188\.114\.|197\.234\.|198\.41\.|173\.245\.|131\.0\.72\.|103\.(21\.244|22\.200|31\.4)\.|2606:4700:|2400:cb00:)'
CF_444=$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null | awk '$9 == 444 {print $1}' | n -E "$CF")

TOP_WEB=$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null | awk '$9 == 444 {print $1}' \
  | excluir | sort | uniq -c | sort -rn | head -5 \
  | awk '{printf "%s%s (%s)", s, $2, $1; s=", "}')

CINCO_XX=$(cat "$TMP/web.log" "$TMP/ip.log" 2>/dev/null | awk '$9 ~ /^5/ {print $1, $7, $9}' | head -3)

LOGIN_FALLIDOS=$(n -E '"POST /api/auth/login[^"]*" (401|403|429)' "$TMP/web.log")
REGISTROS=$(n -E '"POST /api/auth/register[^"]*" (200|201|400|403|422|429)' "$TMP/web.log")

# --- Aplicación ------------------------------------------------------------
SALUD=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  http://127.0.0.1:3000/api/health 2>/dev/null || echo "000")
APP_ERR=$(journalctl -u wanderbibliothek --since "$DESDE 00:00:00" --until "$HASTA 00:00:00" \
  --no-pager 2>/dev/null | grep -v "ERROR_WEBHOOK_URL" \
  | n -iE "\berror\b|uncaught|unhandled|sqlite_|econnreset")
REINICIOS=$(journalctl -u wanderbibliothek --since "$DESDE 00:00:00" --until "$HASTA 00:00:00" \
  --no-pager 2>/dev/null | n "Stopping wanderbibliothek.service")

BD=/var/lib/wanderbibliothek/wanderbibliothek.db
CUENTAS=$(sqlite3 -readonly "$BD" \
  "select count(*) from users where substr(created_at,1,10)='$DESDE';" 2>/dev/null || echo "?")
CUBOS=$(sqlite3 -readonly "$BD" \
  "select bucket||' '||count(*) from throttle group by bucket order by count(*) desc limit 4;" 2>/dev/null \
  | awk '{printf "%s%s %s", s, $1, $2; s=", "}')

ULTIMA_COPIA=$(find /var/backups/wanderbibliothek -maxdepth 1 -type f \
  \( -name '*.db.enc' -o -name '*.db' \) -printf '%T@\n' 2>/dev/null | sort -rn | head -1)
if [ -n "${ULTIMA_COPIA:-}" ]; then
  EDAD_COPIA="$(( ( $(date +%s) - ${ULTIMA_COPIA%%.*} ) / 3600 )) h"
else
  EDAD_COPIA="sin copias"
fi

# --- Cuenta de Mastodon ----------------------------------------------------
# Lo único que no sale de los logs: cuánta gente sigue el bot y cuánto responde
# a lo que publica. El token del servicio solo tiene `read:accounts`, así que la
# cuenta se consulta con él y los estados sin token (son públicos). Se leen con
# Python porque el JSON trae objetos anidados (`reblog`) y contar con `grep`
# sumaba los números del estado original además de los del impulso. Si no hay
# token, red o intérprete, el dato queda en «-»: el informe no depende de esto.
MASTO_SEGUIDORES="-"
MASTO_ME_GUSTA="-"
MASTO_IMPULSOS="-"
TOKEN_MASTO=$(sed -n 's/^MASTODON_TOKEN=//p' /etc/wanderbibliothek/env 2>/dev/null \
  | head -1 | tr -d '"' | tr -d "'" | tr -d '[:space:]')
if [ -n "$TOKEN_MASTO" ] && command -v python3 >/dev/null 2>&1; then
  read -r MASTO_SEGUIDORES MASTO_ME_GUSTA MASTO_IMPULSOS <<< "$(MASTODON_TOKEN="$TOKEN_MASTO" python3 - <<'PY'
import json, os, urllib.request

BASE = "https://mastodon.social"
token = os.environ.get("MASTODON_TOKEN", "")


def pide(ruta, auth=True):
    cabeceras = {"User-Agent": "wanderbibliothek-informe/1.0"}
    if auth and token:
        cabeceras["Authorization"] = "Bearer " + token
    with urllib.request.urlopen(urllib.request.Request(BASE + ruta, headers=cabeceras), timeout=8) as r:
        return json.load(r)


try:
    cuenta = pide("/api/v1/accounts/lookup?acct=wanderbibliothek")
    estados = pide(f"/api/v1/accounts/{cuenta['id']}/statuses?limit=20&exclude_replies=true", auth=False)
    propios = [e for e in estados if not e.get("reblog")]
    print(
        cuenta["followers_count"],
        sum(e["favourites_count"] for e in propios),
        sum(e["reblogs_count"] for e in propios),
    )
except Exception:
    print("- - -")
PY
)"
fi
[ -z "${MASTO_SEGUIDORES:-}" ] && MASTO_SEGUIDORES="-"
[ -z "${MASTO_ME_GUSTA:-}" ] && MASTO_ME_GUSTA="-"
[ -z "${MASTO_IMPULSOS:-}" ] && MASTO_IMPULSOS="-"

# En JSON los «-» tienen que ser `null`, no una cadena vacía.
numero_o_null() { case "${1:-}" in ''|'-') printf 'null' ;; *) printf '%s' "$1" ;; esac; }

# --- Veredicto -------------------------------------------------------------
PROBLEMAS=""
[ "$C5" -gt 0 ] && PROBLEMAS="${PROBLEMAS}${C5} respuestas 5xx; "
[ "$CONTRASENA_ACEPTADA" -gt 0 ] && PROBLEMAS="${PROBLEMAS}SSH aceptó una contraseña; "
[ "$SALUD" != "200" ] && PROBLEMAS="${PROBLEMAS}/api/health responde ${SALUD}; "
[ "$AHORA_SSHD" -eq 0 ] && [ "$FALLOS" -gt 0 ] \
  && PROBLEMAS="${PROBLEMAS}fail2ban no tiene a nadie baneado con ${FALLOS} fallos; "
if [ -n "$PROBLEMAS" ]; then VEREDICTO="revisar: ${PROBLEMAS% }"; else VEREDICTO="sin incidencias"; fi

# --- Salida ----------------------------------------------------------------
lista_json() { # líneas → ["a","b"]
  local s
  s="$(sed '/^$/d' | awk '{printf "%s\"%s\"", s, $1; s=","}')"
  printf '[%s]' "$s"
}

if [ "$FORMATO" = "json" ]; then
  printf '{"servidor":"%s","desde":"%s","hasta":"%s",' "$SERVIDOR" "$DESDE" "$HASTA"
  printf '"ssh":{"fallos":%s,"ips":%s,"usuarios":%s,"nombres":%s,"aceptados":%s,"ips_aceptadas":%s,' \
    "$FALLOS" "$IPS_SSH" "$USUARIOS_N" "$(printf '%s\n' "$USUARIOS" | lista_json)" \
    "$ACEPTADOS_EVENTOS" "$(lista_json < "$TMP/aceptadas.txt")"
  printf '"contrasena_aceptada":%s,"baneos":{"sshd":%s,"scan":%s,"limit":%s},"prorrogados":{"sshd":%s,"scan":%s},' \
    "$CONTRASENA_ACEPTADA" "$BAN_SSHD" "$BAN_SCAN" "$BAN_LIMIT" "$PRO_SSHD" "$PRO_SCAN"
  printf '"baneados_ahora":{"sshd":%s,"scan":%s,"limit":%s}},' "$AHORA_SSHD" "$AHORA_SCAN" "$AHORA_LIMIT"
  printf '"web":{"peticiones":%s,"vhost":%s,"ip_desnuda":%s,"s2xx":%s,"s3xx":%s,"s4xx":%s,"s5xx":%s,' \
    "$WEB_N" "$VHOST_N" "$IPN_N" "$C2" "$C3" "$C4" "$C5"
  printf '"s444":%s,"s403":%s,"s429":%s,"cloudflare_444":%s,' "$S444" "$S403" "$S429" "$CF_444"
  printf '"sondas":{"wordpress":%s,"php":%s,"secretos":%s,"mcp":%s,"admin":%s,"otros":%s},' \
    "$P_WP" "$P_PHP" "$P_SEC" "$P_MCP" "$P_ADM" "$P_OTRO"
  printf '"ref_mastodon":{"paginas":%s,"ips":%s},' "$REF_MAST" "$REF_MAST_IPS"
  printf '"login_fallidos":%s,"registros":%s},' "$LOGIN_FALLIDOS" "$REGISTROS"
  printf '"mastodon":{"ref":{"paginas":%s,"ips":%s},"referer":{"paginas":%s,"ips":%s,"origenes":[%s]},' \
    "$REF_MAST" "$REF_MAST_IPS" "$FEDI_PAGS" "$FEDI_IPS" "$FEDI_ORIGEN_JSON"
  printf '"cuenta":{"seguidores":%s,"me_gusta_ultimos_20":%s,"impulsos_ultimos_20":%s}},' \
    "$(numero_o_null "$MASTO_SEGUIDORES")" "$(numero_o_null "$MASTO_ME_GUSTA")" \
    "$(numero_o_null "$MASTO_IMPULSOS")"
  printf '"app":{"health":"%s","errores":%s,"reinicios":%s,"cuentas_nuevas":%s,"copias":"%s"},' \
    "$SALUD" "$APP_ERR" "$REINICIOS" "$CUENTAS" "$EDAD_COPIA"
  printf '"veredicto":"%s"}\n' "$VEREDICTO"
  [ -n "$PROBLEMAS" ] && exit 1
  exit 0
fi

cat <<TEXTO
Informe de accesos · ${SERVIDOR}
Ventana: ${DESDE} 00:00 → ${HASTA} 00:00 (hora del servidor)
Generado: $(date '+%d-%b-%Y %H:%M') · $(date +%Z)

── SSH ──────────────────────────────────────────────────────────────────
Autenticaciones fallidas : ${FALLOS} (${IPS_SSH} IPs)
Usuario inexistente      : ${USUARIOS_N} nombres → $(printf '%s' "$USUARIOS" | tr '\n' ' ')
Último intento           : ${ULTIMO_SSH:-ninguno}
Atacantes más activos    : ${TOP_SSH:-ninguno}
Accesos correctos        : ${ACEPTADOS_EVENTOS} desde ${ACEPTADOS_IPS} IP(s)$( [ "$ACEPTADOS_IPS" -gt 0 ] && printf ' → %s' "$(tr '\n' ' ' < "$TMP/aceptadas.txt")")
Contraseña aceptada      : ${CONTRASENA_ACEPTADA}$( [ "$CONTRASENA_ACEPTADA" -eq 0 ] && printf ' ✔')
Baneos del día           : sshd ${BAN_SSHD} · scan ${BAN_SCAN} · limit ${BAN_LIMIT} (+${PRO_SSHD} prorrogados, +${PRO_SCAN} scan)
Baneados ahora           : sshd ${AHORA_SSHD} · scan ${AHORA_SCAN} · limit ${AHORA_LIMIT}

── WEB ──────────────────────────────────────────────────────────────────
Peticiones               : ${WEB_N} (vhost ${VHOST_N} · IP desnuda ${IPN_N})
Del bot de Mastodon      : ${REF_MAST} página(s) abiertas con ?ref=mastodon desde ${REF_MAST_IPS} IP(s)
Códigos                  : ${CODIGOS}
Conexiones cerradas 444  : ${S444} de las cuales ${CF_444} por rangos de Cloudflare
Sondas bloqueadas        : WordPress ${P_WP} · .php ${P_PHP} · secretos (.env/.git/.bak) ${P_SEC} · /mcp ${P_MCP} · admin/exploits ${P_ADM} · otras ${P_OTRO}
IPs con más 444          : ${TOP_WEB:-ninguna}
5xx                      : ${C5}$( [ "$C5" -gt 0 ] && printf ' → %s' "$(printf '%s' "$CINCO_XX" | tr '\n' ';')" || printf ' ✔')
429 / 403                : ${S429} / ${S403}
Login fallido (app)      : ${LOGIN_FALLIDOS} · registros enviados: ${REGISTROS}

── APLICACIÓN ───────────────────────────────────────────────────────────
Salud (/api/health)      : ${SALUD}
Errores en el journal    : ${APP_ERR}
Reinicios del servicio   : ${REINICIOS}
Cuentas nuevas           : ${CUENTAS}
Cuotas (ahora)           : ${CUBOS:-ninguna}
Última copia             : ${EDAD_COPIA}

── MASTODON ────────────────────────────────────────────────────────────
Visitas del fediverso    : ${FEDI_PAGS} página(s) desde ${FEDI_IPS} IP(s) por el referer
Origen                   : ${FEDI_ORIGEN:-ninguno}
Cuenta @wanderbibliothek : ${MASTO_SEGUIDORES} seguidores · últimos 20 avisos: ${MASTO_ME_GUSTA} «me gusta» y ${MASTO_IMPULSOS} impulsos

VEREDICTO: ${VEREDICTO}
TEXTO

[ -n "$PROBLEMAS" ] && exit 1
exit 0
REMOTE
