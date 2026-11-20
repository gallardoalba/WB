#!/usr/bin/env bash
#
# Despliega Wanderbibliothek desde la imagen firmada de GHCR.
#
#   sudo deploy/deploy-image.sh --ref 1.0.1          # etiqueta → digest
#   sudo deploy/deploy-image.sh --digest sha256:…    # digest exacto
#   sudo deploy/deploy-image.sh --rollback           # vuelve a la anterior
#   sudo deploy/deploy-image.sh --ref 1.0.1 --dry-run
#
# Qué hace:
#   1. descarga la imagen y resuelve su digest (nunca fija una etiqueta móvil);
#   2. verifica la firma keyless de cosign y la identidad del workflow;
#   3. escribe `/etc/wanderbibliothek/image.env` de forma atómica;
#   4. reinicia el servicio y comprueba `/api/health`;
#   5. si no responde, restaura la imagen anterior y vuelve a arrancar.
#
# Requiere Docker y cosign en el host. Sin cosign se niega a desplegar salvo
# `--allow-unverified`, que existe solo para una instalación de pruebas.
set -euo pipefail

REPO="${IMAGE_REPO:-ghcr.io/gallardoalba/wb}"
REPOSITORY="${IMAGE_REPOSITORY:-gallardoalba/WB}"
WORKFLOW="${REPOSITORY}/.github/workflows/release.yml"
ENV_FILE="${IMAGE_ENV_FILE:-/etc/wanderbibliothek/image.env}"
PREVIOUS="${ENV_FILE}.previous"
SERVICE="${SERVICE:-wanderbibliothek}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
VERSION_URL="${VERSION_URL:-http://127.0.0.1:3000/api/version}"
HEALTH_TRIES="${HEALTH_TRIES:-30}"
DOCKER="${DOCKER_BIN:-/usr/bin/docker}"

REF=""
DIGEST=""
ROLLBACK=0
DRY_RUN=0
ALLOW_UNVERIFIED=0

usage() {
  cat <<'TXT'
Uso: sudo deploy/deploy-image.sh (--ref <etiqueta> | --digest sha256:…)
     sudo deploy/deploy-image.sh --rollback
     [--dry-run] [--allow-unverified]

  --ref        etiqueta publicada (1.0.1, latest…): se resuelve a digest
  --digest     digest exacto (sha256:…)
  --rollback   vuelve a la imagen anterior (`image.env.previous`)
  --dry-run    enseña lo que haría sin escribir ni reiniciar
  --allow-unverified  despliega sin cosign (solo para pruebas)
TXT
}

log() { printf '\n== %s\n' "$*"; }
ok() { printf '   OK    %s\n' "$*"; }
warn() { printf '   AVISO %s\n' "$*"; }
fail() { printf '   FALLO %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:-}"; shift 2 ;;
    --digest) DIGEST="${2:-}"; shift 2 ;;
    --rollback) ROLLBACK=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --allow-unverified) ALLOW_UNVERIFIED=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "argumento no reconocido: $1" ;;
  esac
done

[ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ] && fail "hay que ejecutarlo como root"
command -v "$DOCKER" >/dev/null 2>&1 || fail "falta Docker ($DOCKER)"

health_ok() {
  for _ in $(seq 1 "$HEALTH_TRIES"); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

# ── Rollback ───────────────────────────────────────────────────────────────
if [ "$ROLLBACK" -eq 1 ]; then
  [ -f "$PREVIOUS" ] || fail "no hay imagen anterior en $PREVIOUS"
  log "Volver a la imagen anterior"
  if [ "$DRY_RUN" -eq 1 ]; then
    grep -E '^WANDERBIBLIOTHEK_IMAGE=' "$PREVIOUS" || true
    exit 0
  fi
  swap="$(mktemp)"; cp -a "$ENV_FILE" "$swap"
  cp -a "$PREVIOUS" "$ENV_FILE"
  mv "$swap" "$PREVIOUS"
  systemctl restart "$SERVICE"
  health_ok && { ok "servicio sano con la imagen anterior"; exit 0; }
  fail "la imagen anterior tampoco responde; revisa journalctl -u $SERVICE"
fi

# ── Resolver la referencia ────────────────────────────────────────────────
if [ -n "$DIGEST" ] && [ -n "$REF" ]; then
  fail "usa --ref o --digest, no los dos"
fi
[ -n "$DIGEST" ] || [ -n "$REF" ] || { usage; fail "falta --ref o --digest"; }

if [ -n "$DIGEST" ]; then
  case "$DIGEST" in sha256:*) ;; *) fail "el digest debe empezar por sha256:" ;; esac
  IMAGE="$REPO@$DIGEST"
else
  log "Descargar $REPO:$REF y resolver el digest"
  "$DOCKER" pull "$REPO:$REF" >/dev/null || fail "no se pudo descargar $REPO:$REF"
  IMAGE="$("$DOCKER" inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$REPO:$REF" \
    | grep -m1 "^$REPO@sha256:")" || true
  [ -n "$IMAGE" ] || fail "la imagen no publica un digest de $REPO"
fi

log "Imagen: $IMAGE"
REVISION="$("$DOCKER" image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE" 2>/dev/null || true)"
[ -n "$REVISION" ] && ok "commit de la imagen: $REVISION"

# ── Verificar la firma ────────────────────────────────────────────────────
if command -v cosign >/dev/null 2>&1; then
  log "Verificar la firma (cosign, keyless)"
  cosign verify "$IMAGE" \
    --certificate-identity-regexp "^https://github\\.com/${WORKFLOW}@refs/tags/.*$" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    >/dev/null || fail "la firma no valida: no se despliega"
  ok "firma válida y ligada a este repositorio"
elif [ "$ALLOW_UNVERIFIED" -eq 1 ]; then
  warn "cosign no está instalado: se despliega SIN verificar (--allow-unverified)"
else
  fail "falta cosign: instálalo o usa --allow-unverified solo en pruebas"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "Simulación: se escribiría $ENV_FILE y se reiniciaría $SERVICE"
  exit 0
fi

"$DOCKER" pull "$IMAGE" >/dev/null || fail "no se pudo descargar $IMAGE"

# ── Escribir image.env ────────────────────────────────────────────────────
DB_PATH="$(sed -n 's/^WANDERBIBLIOTHEK_DB=//p' /etc/wanderbibliothek/env 2>/dev/null | head -1)"
BACKUP_PATH="$(sed -n 's/^WANDERBIBLIOTHEK_BACKUP_DIR=//p' /etc/wanderbibliothek/env 2>/dev/null | head -1)"
DATA_DIR="${DB_PATH%/*}"; [ "$DATA_DIR" = "$DB_PATH" ] && DATA_DIR=/var/lib/wanderbibliothek
BACKUP_DIR="${BACKUP_PATH:-/var/backups/wanderbibliothek}"
CACHE_DIR="$DATA_DIR/next-cache"
RUN_UID="$(id -u wanderbibliothek 2>/dev/null || echo 999)"
RUN_GID="$(id -g wanderbibliothek 2>/dev/null || echo 988)"

log "Fijar la imagen y los UID del host en $ENV_FILE"
if [ -f "$ENV_FILE" ] && ! grep -q "^WANDERBIBLIOTHEK_IMAGE=$IMAGE$" "$ENV_FILE"; then
  cp -a "$ENV_FILE" "$PREVIOUS"
  ok "imagen anterior guardada para --rollback"
fi
temporary="$(mktemp)"
{
  printf '# Escrito por deploy/deploy-image.sh. No editar a mano.\n'
  printf 'WANDERBIBLIOTHEK_IMAGE=%s\n' "$IMAGE"
  printf 'WANDERBIBLIOTHEK_RUN_UID=%s\n' "$RUN_UID"
  printf 'WANDERBIBLIOTHEK_RUN_GID=%s\n' "$RUN_GID"
  printf 'WANDERBIBLIOTHEK_HOST_DATA=%s\n' "$DATA_DIR"
  printf 'WANDERBIBLIOTHEK_HOST_BACKUPS=%s\n' "$BACKUP_DIR"
  printf 'WANDERBIBLIOTHEK_HOST_CACHE=%s\n' "$CACHE_DIR"
} > "$temporary"
install -m 600 -o root -g root "$temporary" "$ENV_FILE"
rm -f "$temporary"
ok "referencia fijada por digest"

# La caché de Next la escribe el proceso dentro del contenedor con el UID del
# host; si no existe o es de otro dueño, `next start` falla al primer render.
install -d -m 700 -o "$RUN_UID" -g "$RUN_GID" "$CACHE_DIR"
ok "caché escribible en $CACHE_DIR"

# ── Activar y comprobar ───────────────────────────────────────────────────
log "Reiniciar $SERVICE"
systemctl restart "$SERVICE"

if health_ok; then
  ok "servicio sano"
  curl -fsS --max-time 3 "$VERSION_URL" || true
  printf '\n'
else
  warn "no responde; se restaura la imagen anterior"
  if [ -f "$PREVIOUS" ]; then
    cp -a "$PREVIOUS" "$ENV_FILE"
    systemctl restart "$SERVICE"
    health_ok && fail "la imagen nueva falló; se ha vuelto a la anterior"
  fi
  fail "el servicio no arranca; revisa journalctl -u $SERVICE"
fi

log "Invalidar la caché de imágenes de nginx"
if [ -d /var/cache/nginx/wb_images ]; then
  find /var/cache/nginx/wb_images -type f -delete \
    || fail "no se pudo invalidar la caché de nginx; revisa /var/cache/nginx/wb_images"
  ok "caché de portadas y versiones optimizadas invalidada"
else
  warn "no existe /var/cache/nginx/wb_images; no hay caché de imágenes que invalidar"
fi
