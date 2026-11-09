#!/bin/sh
# Copia externa «por tracción» de la base de datos.
#
# Se ejecuta en el **portátil** (o en cualquier máquina tuya), no en el
# servidor: un `push` desde el VPS necesita que el destino sea alcanzable, y un
# `pull` funciona aunque el portátil esté detrás de un NAT o con IP dinámica.
# En el servidor nada cambia: sigue haciendo su copia diaria (cifrada si existe
# `WANDERBIBLIOTHEK_BACKUP_KEY`) y este script la recoge.
#
#   ./deploy/backup-pull.sh                 # trae, rota y verifica la última
#   VERIFY=0 ./deploy/backup-pull.sh        # sin descifrar (más rápido)
#   WANDERBIBLIOTHEK_BACKUP_LOCAL_KEEP=60 ./deploy/backup-pull.sh
#
# Variables:
#   WANDERBIBLIOTHEK_BACKUP_HOST        alias SSH del servidor (wanderbibliothek)
#   WANDERBIBLIOTHEK_BACKUP_REMOTE_DIR  carpeta de copias en el servidor
#   WANDERBIBLIOTHEK_BACKUP_LOCAL_DIR   destino local (~/backups/wanderbibliothek)
#   WANDERBIBLIOTHEK_BACKUP_LOCAL_KEEP  copias que se conservan en local (30)
#   WANDERBIBLIOTHEK_BACKUP_KEY_FILE    fichero con la clave (~/.config/wanderbibliothek/backup-key)
#
# La verificación descifra la copia más reciente y comprueba que abre como base
# SQLite: una copia que no se puede restaurar no es una copia.
set -eu

HOST="${WANDERBIBLIOTHEK_BACKUP_HOST:-wanderbibliothek}"
REMOTE="${WANDERBIBLIOTHEK_BACKUP_REMOTE_DIR:-/var/backups/wanderbibliothek}"
DEST="${WANDERBIBLIOTHEK_BACKUP_LOCAL_DIR:-$HOME/backups/wanderbibliothek}"
KEEP="${WANDERBIBLIOTHEK_BACKUP_LOCAL_KEEP:-30}"
KEY_FILE="${WANDERBIBLIOTHEK_BACKUP_KEY_FILE:-$HOME/.config/wanderbibliothek/backup-key}"
VERIFY="${VERIFY:-1}"
AQUI=$(cd "$(dirname "$0")/.." && pwd)

mkdir -p "$DEST"

# `tar` por SSH y no `rsync`: el servidor no tiene por qué tener rsync, y así
# viaja la carpeta entera (unas pocas copias) en una sola conexión.
ssh "$HOST" "sudo tar -C '$REMOTE' -cf - ." | tar -C "$DEST" -xf -

# Restos de versiones anteriores: junto a cada copia cifrada quedaban
# `-shm`/`-wal` huérfanos que el `tar` volvía a traer en cada pasada.
rm -f "$DEST"/wanderbibliothek-*.db-shm "$DEST"/wanderbibliothek-*.db-wal

# Rotación local: se conservan las N más recientes.
ls -1t "$DEST"/wanderbibliothek-*.db.enc 2>/dev/null \
  | tail -n +$((KEEP + 1)) \
  | while read -r vieja; do
      rm -f "$vieja"
      echo "Copia local antigua eliminada: $(basename "$vieja")"
    done

ULTIMA=$(ls -1t "$DEST"/wanderbibliothek-*.db.enc 2>/dev/null | head -1 || true)
if [ -z "$ULTIMA" ]; then
  echo "No hay ninguna copia cifrada en $DEST: revisa WANDERBIBLIOTHEK_BACKUP_KEY en el servidor." >&2
  exit 1
fi

if [ "$VERIFY" = "1" ]; then
  if [ ! -f "$KEY_FILE" ]; then
    echo "No se puede verificar: falta la clave en $KEY_FILE (chmod 600)." >&2
    exit 1
  fi
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  # `--import tsx` se resuelve desde el **directorio actual**, no desde el
  # script: sin este `cd`, cualquier ejecución fuera del repositorio (el timer
  # de usuario arranca en $HOME) moría con ERR_MODULE_NOT_FOUND y la copia no
  # se verificaba nunca.
  (
    cd "$AQUI"
    WANDERBIBLIOTHEK_BACKUP_KEY=$(cat "$KEY_FILE") \
      node --import tsx "$AQUI/scripts/decrypt-backup.ts" "$ULTIMA" "$TMP/copia.db"
  ) >/dev/null
  if command -v sqlite3 >/dev/null 2>&1; then
    INTEGRIDAD=$(sqlite3 "$TMP/copia.db" "PRAGMA quick_check;")
    if [ "$INTEGRIDAD" != "ok" ]; then
      echo "La copia descifrada no pasa la comprobación de integridad: $INTEGRIDAD" >&2
      exit 1
    fi
  fi
  echo "Verificada: $(basename "$ULTIMA") se descifra y abre como SQLite."
fi

echo "Copias en $DEST: $(ls -1 "$DEST"/wanderbibliothek-*.db.enc 2>/dev/null | wc -l) (máximo $KEEP)."
