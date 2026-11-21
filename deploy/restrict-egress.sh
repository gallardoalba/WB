#!/usr/bin/env bash
# Cierra la salida hacia redes internas y metadatos del proveedor de nube.
#
# El endpoint de Web Push llega desde el navegador, así que el servidor hace
# peticiones salientes a una URL ajena. El código ya exige https, puerto 443 y
# una lista de hosts conocidos (`isAllowedPushEndpoint`), pero la lista de
# hosts no impide que un DNS comprometido apunte a una dirección interna. Esta
# regla es la segunda barrera y no depende del código.
#
# Uso:
#   ./restrict-egress.sh                 # enseña las reglas (no cambia nada)
#   sudo ./restrict-egress.sh --apply    # las carga en el cortafuegos
#   sudo ./restrict-egress.sh --apply --docker
#                                        # además las aplica a los contenedores
#
# En modo `--docker` hace falta que el cortafuegos tenga la cadena
# `DOCKER-USER` (la crea Docker). Sin ella, el script se detiene antes de tocar
# nada.
set -euo pipefail

CADENA="wanderbibliothek-egress"
APLICAR=0
DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --apply) APLICAR=1 ;;
    --docker) DOCKER=1 ;;
    -h | --help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'Opción desconocida: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

REDES=(
  "10.0.0.0/8"
  "172.16.0.0/12"
  "192.168.0.0/16"
  "169.254.0.0/16"
  "127.0.0.0/8"
  "::1/128"
  "fc00::/7"
  "fe80::/10"
)
# Direcciones de metadatos de los proveedores de nube: 169.254.169.254 queda
# dentro de 169.254/16, pero se nombran aparte porque son el objetivo real de
# un SSRF y conviene que se lean en el listado.
METADATOS=("169.254.169.254/32" "fd00:ec2::254/128")

reglas() {
  cat <<'TXT'
table inet wanderbibliothek_egress {
  chain salida {
    type filter hook output priority 0; policy accept;
    ct state established,related accept
    oifname "lo" accept
    # Redes internas y metadatos: se descartan, no se rechazan, para no
    # revelar que hay un cortafuegos al otro lado.
    ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 127.0.0.0/8 } drop
    ip6 daddr { ::1/128, fc00::/7, fe80::/10, fd00:ec2::254/128 } drop
    ip daddr 169.254.169.254 drop
  }
}
TXT
}

reglas_docker() {
  cat <<'TXT'
# En el host con Docker, el tráfico del contenedor no pasa por `output`:
# hay que filtrarlo en DOCKER-USER, que se evalúa antes que las reglas de
# Docker y no las reescribe.
table inet wanderbibliothek_egress {
  chain docker_salida {
    type filter hook forward priority -150; policy accept;
    ct state established,related accept
    ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 } drop
    ip6 daddr { fc00::/7, fe80::/10, fd00:ec2::254/128 } drop
    ip daddr 169.254.169.254 drop
  }
}
TXT
}

if [[ "$APLICAR" -eq 0 ]]; then
  printf '# Reglas que se cargarían con --apply\n\n'
  reglas
  if [[ "$DOCKER" -eq 1 ]]; then
    printf '\n'
    reglas_docker
  fi
  printf '\n# Redes cubiertas: %s\n' "${REDES[*]}"
  printf '# Metadatos: %s\n' "${METADATOS[*]}"
  exit 0
fi

[[ "$(id -u)" -eq 0 ]] || {
  printf 'Hace falta root para cargar las reglas.\n' >&2
  exit 1
}
command -v nft >/dev/null 2>&1 || {
  printf 'Falta nftables (paquete `nftables`).\n' >&2
  exit 1
}

if [[ "$DOCKER" -eq 1 ]] && ! nft list chain inet filter DOCKER-USER >/dev/null 2>&1; then
  printf 'No existe la cadena DOCKER-USER: ¿está Docker instalado y arrancado?\n' >&2
  exit 1
fi

# Se reemplaza la tabla entera: el script es idempotente y no acumula reglas.
nft delete table inet wanderbibliothek_egress 2>/dev/null || true
if [[ "$DOCKER" -eq 1 ]]; then
  reglas_docker | nft -f -
else
  reglas | nft -f -
fi
printf 'Reglas cargadas en la tabla inet wanderbibliothek_egress.\n'
printf 'Comprobación: nft list table inet wanderbibliothek_egress\n'
