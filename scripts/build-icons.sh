#!/usr/bin/env bash
# Genera los iconos PNG de la web (y el de la ficha de F-Droid) a partir de los
# SVG de `public/icons/`. El SVG es la fuente: sin él, los PNG se vuelven
# originales irrepetibles (y así apareció una cifra «3» que nadie supo explicar).
#
#   ./scripts/build-icons.sh
#
# Necesita `rsvg-convert` (librsvg2-bin) o, en su defecto, `magick`.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=public/icons
FDROID=android/fastlane/metadata/android/en-US/images

render() {
  local svg=$1 png=$2 size=$3
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$size" -h "$size" "$svg" -o "$png"
  else
    magick -background none -density 1200 "$svg" -resize "${size}x${size}" "$png"
  fi
  echo "  $png ($size×$size)"
}

echo "Iconos:"
render "$OUT/icon.svg" "$OUT/icon-512.png" 512
render "$OUT/icon.svg" "$OUT/icon-192.png" 192
render "$OUT/icon-maskable.svg" "$OUT/icon-maskable-512.png" 512
# iOS aplica su propia máscara: se le da el fondo a sangre, sin esquinas.
render "$OUT/icon-maskable.svg" "$OUT/apple-touch-icon.png" 180

# El favicon de Next es el mismo dibujo: se copia para que no diverjan.
cp "$OUT/icon.svg" src/app/icon.svg
echo "  src/app/icon.svg (copia)"

# F-Droid toma el icono de la ficha (512×512).
mkdir -p "$FDROID"
cp "$OUT/icon-512.png" "$FDROID/icon.png"
echo "  $FDROID/icon.png (copia)"
