#!/usr/bin/env bash
#
# Comprueba que una imagen de Wanderbibliothek salió de este repositorio.
#
#   ./deploy/verify-release.sh ghcr.io/gallardoalba/wb@sha256:…
#
# Necesita `cosign` (https://docs.sigstore.dev/cosign/installation/). Si además
# está `slsa-verifier`, comprueba también la provenance SLSA. No descarga ni
# ejecuta la imagen: solo verifica firmas y attestations contra el registro.
#
# Códigos de salida:
#   0  la imagen está firmada por el workflow de release de este repositorio
#   1  la firma no valida o la referencia no lleva digest
#   2  falta una herramienta
set -euo pipefail

REPOSITORY="gallardoalba/WB"
WORKFLOW="${REPOSITORY}/.github/workflows/release.yml"
IMAGE="${1:-${WANDERBIBLIOTHEK_IMAGE:-}}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ -n "$IMAGE" ] || fail "indica la imagen: $0 ghcr.io/${REPOSITORY,,}@sha256:…"

case "$IMAGE" in
  *@sha256:*) ;;
  *) fail "la referencia no lleva digest (@sha256:…): una etiqueta puede moverse y la firma no la seguiría" ;;
esac

command -v cosign >/dev/null 2>&1 || {
  printf 'Falta cosign: https://docs.sigstore.dev/cosign/installation/\n' >&2
  exit 2
}

printf 'Verificando %s\n' "$IMAGE"
cosign verify "$IMAGE" \
  --certificate-identity-regexp "^https://github\.com/${WORKFLOW}@refs/tags/.*$" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

if command -v slsa-verifier >/dev/null 2>&1; then
  printf '\nVerificando la provenance SLSA…\n'
  slsa-verifier verify-image "$IMAGE" --source-uri "github.com/${REPOSITORY}"
else
  printf '\nAviso: sin slsa-verifier no se comprueba la provenance SLSA.\n' >&2
fi

printf '\nImagen verificada: %s\n' "${IMAGE##*@}"
