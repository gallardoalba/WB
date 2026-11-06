# Publicar en F-Droid

F-Droid **no acepta APK**: compila la app desde el código y firma el resultado
con su propia clave. Eso condiciona la lista de tareas.

## Lo que ya cumple el proyecto

| Requisito | Estado |
|---|---|
| Licencia libre | ✔ **MIT** (`LICENSE`), compatible con F-Droid |
| Sin dependencias propietarias | ✔ solo AndroidX/Compose (Apache-2.0), sin servicios de terceros ni Firebase |
| Servidor también libre | ✔ el servidor es MIT: no hay *anti-feature* `NonFreeNet` |
| Compila desde una copia limpia | ✔ `./gradlew :app:assembleRelease` sin `ANDROID_SIGNING_*` produce `app-release-unsigned.apk` (lo que F-Droid firma) |
| Sin anuncios, rastreo ni cuentas de terceros | ✔ |
| Metadatos de la ficha | ⬜ `fastlane/metadata/android/{de-DE,es-ES}/` creado; **faltan capturas e icono 512** |
| Etiquetas de versión | ⬜ el repositorio no tiene ningún tag todavía |

## Paso 1 · Etiquetar la versión

F-Droid construye desde un *commit* publicado, no desde un APK. El `versionCode`
y el `versionName` del tag tienen que coincidir con el YAML:

```sh
cd /home/nouser/Desktop/wanderbibliothek
grep -n 'versionCode\|versionName' android/app/build.gradle.kts   # 2 / 0.1.2
git tag -a v0.1.2 -m "Wanderbibliothek 0.1.2 para F-Droid"
git push origin v0.1.2
```

Para cada versión nueva:

```sh
cd /home/nouser/Desktop/wanderbibliothek/android
./scripts/build-apk.sh --bump --version 0.2.0   # sube versionCode y nombre
git add app/build.gradle.kts && git commit -m "Android 0.2.0"
git tag -a v0.2.0 -m "Wanderbibliothek 0.2.0"
git push && git push origin v0.2.0
```

El APK de `dist/` sirve para instalarlo tú; para F-Droid lo que cuenta es el
tag: ellos vuelven a compilar desde ahí. Conviene probar ese mismo camino en
limpio antes de etiquetar (paso 5).

## Paso 2 · Completar la ficha

`fastlane/metadata/android/<locale>/` ya tiene `title.txt`,
`short_description.txt` y `full_description.txt` en `de-DE` y `es-ES`. Falta:

- `icon.png` — 512×512, sin transparencia.
- `images/phoneScreenshots/1.png`, `2.png`… (mínimo dos, lado ≥ 320 px).

Los textos están pensados para la comunidad (no solo «compartir libros»), igual
que la portada nueva de la app.

## Paso 3 · Pedir la inclusión en F-Droid

1. Bifurca <https://gitlab.com/fdroid/fdroiddata>.
2. Copia `android/fdroid/org.wanderbibliothek.app.yml` a
   `metadata/org.wanderbibliothek.app.yml` y ajusta versión y commit.
3. Abre una *merge request* con el título
   `New app: org.wanderbibliothek.app`.

El *build* se declara con `subdir: android` y `gradle: - yes`; F-Droid añade
`ANDROID_HOME` y compila sin red, así que si su servidor se queja de las
dependencias pedirá declarar los repositorios Maven (`maven:`) en el propio
YAML: es la primera cosa que suele pedir el revisor. La revisión tarda
**semanas** (a veces meses) y no hay atajo.

## Paso 4 · La firma cambia (importante)

F-Droid firma con **su** clave. Consecuencias:

- Quien tenga el APK de `dist/` (firmado con `~/wanderbibliothek.jks`) **no
  podrá actualizar** al de F-Droid: Android rechazará la instalación y habrá que
  desinstalar antes, lo que **borra la clave de cifrado** guardada en el Keystore
  de ese móvil.
- La ficha de F-Droid y la web deben avisar de eso mientras convivan las dos
  distribuciones.

Tres formas de evitarlo, de menos a más trabajo:

1. **IzzyOnDroid** (<https://apt.izzysoft.de/fdroid>): repositorio alternativo
   que acepta el APK firmado por ti. Se pide por *issue* en
   `IzzyOnDroid/repo` y suele estar en días. Es el camino más corto hoy.
2. **Repositorio propio** con `fdroidserver`: firmas tú y publicas el índice en
   `wanderbibliothek.org/fdroid/repo`, que es una carpeta estática. Control
   total, cero revisión.
3. **Reproducible builds** en F-Droid: se puede mantener tu firma si el APK que
   construyen ellos es idéntico bit a bit al tuyo y se declara `Binaries:` con
   la huella de tu clave. Con R8 y Compose es difícil de conseguir; solo tiene
   sentido si F-Droid pasa a ser el canal principal.

## Paso 5 · Comprobaciones antes de enviar

```sh
# 1. ¿Compila sin firma propia? (lo que hará F-Droid)
unset ANDROID_SIGNING_STORE_FILE ANDROID_SIGNING_KEY_ALIAS \
      ANDROID_SIGNING_STORE_PASSWORD ANDROID_SIGNING_KEY_PASSWORD
cd android && ./gradlew clean :app:assembleRelease
ls app/build/outputs/apk/release/app-release-unsigned.apk

# 2. ¿Las pruebas y el lint pasan?
./gradlew :app:testDebugUnitTest :app:lintDebug

# 3. ¿La ficha está completa?
find fastlane -type f | sort
```

Y una revisión de privacidad que F-Droid mira con lupa:

- Solo se pide el permiso `INTERNET` ✔
- No hay `WebView`, ni analítica, ni identificadores de publicidad ✔
- `allowBackup="false"` y sin copias al cloud ✔
- El servidor por defecto es tuyo y **se puede cambiar** en Ajustes; el código
  del servidor es público: eso evita la *anti-feature* `NonFreeNet`.

## Resumen del orden recomendado

1. Publicar en **IzzyOnDroid** ya (misma firma, misma app, sin esperar).
2. Completar icono y capturas en `fastlane/`.
3. Etiquetar `v0.1.2` y abrir la MR en `fdroiddata`.
4. Avisar en la web de que F-Droid usa otra firma antes de que aparezca.

## Notas

- F-Droid **no** exige moderación ni denuncia dentro de la app como otras
  tiendas: que la app aún no permita bloquear o denunciar a alguien (la web sí)
  es una mejora de producto pendiente, no un requisito para entrar aquí.
- La clave del APK propio (`~/wanderbibliothek.jks`) sigue haciendo falta para
  IzzyOnDroid y para el repositorio propio: guárdala con sus contraseñas.
- El `--bump` del script es lo único que hay que recordar en cada versión: un
  `versionCode` repetido hace que F-Droid ignore la actualización.
