#!/usr/bin/env bash
#
# Construye un APK o un AAB listo para publicar: comprueba la firma, sube el
# versionCode si se pide y lo deja con un nombre propio en `dist/`.
#
#   ./scripts/build-apk.sh                      # release firmado
#   ./scripts/build-apk.sh --bump               # release con versionCode + 1
#   ./scripts/build-apk.sh --bump --version 0.2.0
#   ./scripts/build-apk.sh --bundle             # AAB para Google Play
#   ./scripts/build-apk.sh --debug              # APK de depuración (sin firma propia)
#
# El release se firma con ANDROID_SIGNING_STORE_FILE y ANDROID_SIGNING_KEY_ALIAS;
# las contraseñas se piden con la entrada oculta si no están exportadas, y el
# almacén se comprueba con keytool antes de gastar un minuto compilando.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"

gradle_file="app/build.gradle.kts"
variant="release"
kind="apk"
ext="apk"
bump=0
new_version=""
out_dir="dist"

usage() {
  sed -n '3,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug) variant="debug" ;;
    --bundle) kind="aab" ;;
    --bump) bump=1 ;;
    --version)
      new_version="${2:?falta el número de versión después de --version}"
      shift
      ;;
    --out)
      out_dir="${2:?falta la carpeta después de --out}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Opción desconocida: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
  shift
done

for tool in ./gradlew python3; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Falta $tool: ejecuta el script desde android/ con el SDK instalado." >&2
    exit 1
  }
done

if [[ "$kind" == "aab" && "$variant" == "debug" ]]; then
  echo "--bundle no combina con --debug: un AAB de depuración no sirve para Play." >&2
  exit 64
fi

# Lee `versionCode`/`versionName` de `defaultConfig`. El APK se llama igual sin
# tocar el fichero, así que se lee y se escribe con el mismo criterio.
read_version() {
  python3 - "$gradle_file" "$1" <<'PY'
import re, sys

path, key = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
match = re.search(rf'^\s*{key}\s*=\s*"?([^"\n]+)"?', text, re.MULTILINE)
print(match.group(1).strip() if match else "")
PY
}

# Sustituye el valor sin tocar el resto del fichero: las cifras van sin comillas
# y el nombre de versión con ellas, como en el original.
set_version() {
  python3 - "$gradle_file" "$1" "$2" <<'PY'
import re, sys

path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
replacement = value if value.isdigit() else '"%s"' % value
pattern = re.compile(rf'^(\s*{key}\s*=\s*)"?[^"\n]+"?', re.MULTILINE)
updated, count = pattern.subn(rf"\g<1>{replacement}", text, count=1)
if count != 1:
    sys.exit(f"No se encontró {key} en {path}")
open(path, "w", encoding="utf-8").write(updated)
PY
}

version_code="$(read_version versionCode)"
version_name="$(read_version versionName)"
[[ -n "$version_code" && -n "$version_name" ]] || {
  echo "No se pudo leer la versión de $gradle_file" >&2
  exit 1
}

if [[ "$bump" == 1 ]]; then
  next_code=$((version_code + 1))
  set_version versionCode "$next_code"
  version_code="$next_code"
fi
if [[ -n "$new_version" ]]; then
  set_version versionName "$new_version"
  version_name="$new_version"
fi

if [[ "$variant" == "release" ]]; then
  missing=()
  for name in ANDROID_SIGNING_STORE_FILE ANDROID_SIGNING_KEY_ALIAS; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  if ((${#missing[@]} > 0)); then
    cat >&2 <<EOF
Faltan variables de firma: ${missing[*]}

Un APK de release sin firmar no se puede instalar. Crea el keystore una vez:

  keytool -genkeypair -v -storetype PKCS12 -keystore ~/wanderbibliothek.jks \\
    -alias wanderbibliothek -keyalg RSA -keysize 4096 -validity 10000

y expórtalas en tu terminal (nunca en el repositorio):

  export ANDROID_SIGNING_STORE_FILE=~/wanderbibliothek.jks
  export ANDROID_SIGNING_KEY_ALIAS=wanderbibliothek

Las contraseñas se piden aquí, con la entrada oculta, si no están exportadas.
Para probar en tu propio teléfono sin keystore, usa --debug.
EOF
    exit 2
  fi

  # Sin terminal (CI, tubería) no se puede preguntar: o vienen del entorno o se
  # explica en vez de dejar que Gradle falle un minuto después.
  if [[ -z "${ANDROID_SIGNING_STORE_PASSWORD:-}" ]]; then
    if [[ -t 0 ]]; then
      read -rsp "Contraseña del almacén de claves: " ANDROID_SIGNING_STORE_PASSWORD
      echo
      export ANDROID_SIGNING_STORE_PASSWORD
    else
      echo "Falta ANDROID_SIGNING_STORE_PASSWORD y no hay terminal para pedirla." >&2
      exit 2
    fi
  fi
  if [[ -z "${ANDROID_SIGNING_KEY_PASSWORD:-}" ]]; then
    if [[ -t 0 ]]; then
      key_password=""
      read -rsp "Contraseña de la clave (Enter si es la misma): " key_password
      echo
      ANDROID_SIGNING_KEY_PASSWORD="${key_password:-$ANDROID_SIGNING_STORE_PASSWORD}"
    else
      ANDROID_SIGNING_KEY_PASSWORD="$ANDROID_SIGNING_STORE_PASSWORD"
    fi
    export ANDROID_SIGNING_KEY_PASSWORD
  fi

  if [[ ! -f "$ANDROID_SIGNING_STORE_FILE" ]]; then
    echo "El keystore no existe: $ANDROID_SIGNING_STORE_FILE" >&2
    echo "Créalo con el keytool del mensaje de ayuda (./scripts/build-apk.sh --help)." >&2
    exit 2
  fi

  # Comprobar el almacén antes de compilar: el error de Gradle («keystore
  # password was incorrect») aparece un minuto después y no dice cuál de las dos
  # contraseñas falla. `-storepass:env` evita pasarla por la línea de comandos.
  if command -v keytool >/dev/null 2>&1; then
    if ! keytool -list -keystore "$ANDROID_SIGNING_STORE_FILE" \
      -storepass:env ANDROID_SIGNING_STORE_PASSWORD >/dev/null 2>&1; then
      cat >&2 <<EOF
La contraseña del almacén no abre $ANDROID_SIGNING_STORE_FILE.

  · ¿La escribiste con comillas simples? Sin ellas, \$ o ! la alteran.
  · ¿La exportaste en *otra* terminal? El entorno no se hereda entre ellas.
  · Comprueba a mano:  keytool -list -keystore "$ANDROID_SIGNING_STORE_FILE"
EOF
      exit 3
    fi
    if ! keytool -exportcert -rfc -alias "$ANDROID_SIGNING_KEY_ALIAS" \
      -keystore "$ANDROID_SIGNING_STORE_FILE" \
      -storepass:env ANDROID_SIGNING_STORE_PASSWORD >/dev/null 2>&1; then
      echo "El alias «$ANDROID_SIGNING_KEY_ALIAS» no existe en el almacén." >&2
      echo "Mira los que hay:  keytool -list -keystore \"$ANDROID_SIGNING_STORE_FILE\"" >&2
      exit 3
    fi

    # Un PKCS12 guarda una sola contraseña: si la de la clave difiere, keytool
    # solo puede reportar «keystore password was incorrect».
    keystore_type="$(python3 - "$ANDROID_SIGNING_STORE_FILE" <<'PY'
import sys

head = open(sys.argv[1], "rb").read(1)
print("PKCS12" if head == b"\x30" else "JKS")
PY
)"
    if [[ "$keystore_type" == "PKCS12" &&
      "$ANDROID_SIGNING_STORE_PASSWORD" != "$ANDROID_SIGNING_KEY_PASSWORD" ]]; then
      echo "En un almacén PKCS12 la contraseña de la clave debe ser la misma que la del almacén." >&2
      echo "Vuelve a exportar ANDROID_SIGNING_KEY_PASSWORD con el mismo valor." >&2
      exit 3
    fi
  fi

  task=":app:assembleRelease"
  built="app/build/outputs/apk/release/app-release.apk"
  suffix=""
else
  task=":app:assembleDebug"
  built="app/build/outputs/apk/debug/app-debug.apk"
  suffix="-debug"
fi

if [[ "$kind" == "aab" ]]; then
  # Un AAB no se instala: es el paquete que Play divide por dispositivo. Se
  # firma con la misma clave de subida.
  task=":app:bundleRelease"
  built="app/build/outputs/bundle/release/app-release.aab"
  suffix=""
  ext="aab"
fi

echo "Compilando $variant · $version_name (versionCode $version_code)"
if ! ./gradlew "$task"; then
  cat >&2 <<EOF

La compilación falló. Si el error menciona «keystore password was incorrect»:

  · Las dos contraseñas (almacén y clave) deben coincidir en un PKCS12.
  · Un almacén creado dos veces conserva la contraseña de la última vez.
  · Regenera el APK sin firma propia con:  ./scripts/build-apk.sh --debug
EOF
  exit 1
fi

[[ -f "$built" ]] || {
  echo "Gradle no dejó el paquete esperado en $built" >&2
  exit 1
}

# Comprobar la firma aquí evita descubrir en el teléfono (o en Play) que el
# paquete no sirve. El AAB va firmado como JAR, no con el esquema de APK.
sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$sdk_dir" && -f local.properties ]]; then
  sdk_dir="$(sed -n 's/^sdk\.dir=//p' local.properties)"
fi
apksigner_bin=""
if [[ -n "$sdk_dir" ]]; then
  apksigner_bin="$(ls -1 "$sdk_dir"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1 || true)"
fi
if [[ -z "$apksigner_bin" ]] && command -v apksigner >/dev/null 2>&1; then
  apksigner_bin="$(command -v apksigner)"
fi
if [[ "$ext" == "aab" ]]; then
  # Sin `-strict`: el certificado de firma de Android es autofirmado y `-strict`
  # lo cuenta como error (código 4) aunque el JAR esté bien firmado.
  if command -v jarsigner >/dev/null 2>&1; then
    jarsigner -verify "$built" >/dev/null 2>&1 || {
      echo "El AAB no está firmado correctamente: Play lo rechazaría." >&2
      exit 1
    }
  elif ! unzip -l "$built" 2>/dev/null | grep -qE 'META-INF/[^/]+\.(RSA|EC|DSA)$'; then
    echo "El AAB no lleva bloque de firma: Play lo rechazaría." >&2
    exit 1
  fi
elif [[ -z "$apksigner_bin" ]]; then
  echo "Aviso: no encuentro apksigner; no compruebo la firma." >&2
else
  "$apksigner_bin" verify --print-certs "$built" >/dev/null || {
    echo "La firma del APK no verifica: no lo instales." >&2
    exit 1
  }
fi

mkdir -p "$out_dir"
# Ruta absoluta: con `--out /tmp/x` la ruta relativa no sirve para el mensaje.
out_abs="$(cd "$out_dir" && pwd)"
target="$out_abs/wanderbibliothek-$version_name$suffix.$ext"
cp "$built" "$target"

echo
echo "paquete $target"
echo "versión $version_name (versionCode $version_code)"
echo "tamaño  $(du -h "$target" | cut -f1 | tr -d '[:space:]')"
echo "sha256  $(sha256sum "$target" | cut -d' ' -f1)"
echo
if [[ "$ext" == "aab" ]]; then
  echo "Subir a Play Console → Pruebas → Prueba interna (el AAB no se instala a mano)."
else
  echo "Instalar con cable:  adb install -r \"$target\""
  echo "Sin cable: copia ese fichero al teléfono y ábrelo con el gestor de archivos."
fi
