# Template Android

Base reutilizable para aplicaciones Android con Kotlin y Jetpack Compose.

## Incluye

- Navegación inferior entre Inicio, Componentes y Ajustes.
- Tema Material 3 con opciones Sistema, Claro y Oscuro; la preferencia se guarda en el dispositivo.
- Pantalla de ejemplo con estado, validación de formulario y controles Compose.
- ViewModel y repositorio de preferencias separados de la interfaz.
- Pruebas JVM para la lectura de preferencias.

## Ejecutar

Abre el proyecto en Android Studio y espera a que termine la sincronización de Gradle. Ejecuta la configuración `app` en un emulador o en un dispositivo Android conectado.

También puedes compilar el APK de depuración desde una terminal:

```sh
./gradlew :app:assembleDebug
```

El APK se genera en `app/build/outputs/apk/debug/app-debug.apk`.

## Release

Compila una versión optimizada con R8 y reducción de recursos:

```sh
./gradlew :app:assembleRelease
```

El APK Release queda sin firmar si no configuras la firma. Para firmarlo, define `ANDROID_SIGNING_STORE_FILE`, `ANDROID_SIGNING_STORE_PASSWORD`, `ANDROID_SIGNING_KEY_ALIAS` y `ANDROID_SIGNING_KEY_PASSWORD` en el entorno antes de compilar. No guardes contraseñas ni archivos de claves en el repositorio.

Ejecuta las pruebas unitarias con:

```sh
./gradlew :app:testDebugUnitTest
```

## Java

Usa JDK 17 o posterior. Gradle toma el JDK activo en el entorno o el configurado en Android Studio; el proyecto no fuerza la descarga de otro JDK.

## Estructura

- `ui/TemplateApp.kt`: scaffold y rutas de navegación.
- `ui/screens/`: pantallas de ejemplo.
- `ui/theme/`: colores y tema Material 3.
- `ui/AppViewModel.kt`: estado de interfaz y acciones.
- `data/AppPreferencesRepository.kt`: preferencias persistentes.
- `src/test/`: pruebas unitarias locales.
- `src/main/res/values/strings.xml` y `values-es/strings.xml`: textos en inglés y español.

## Dependencias y equipos modestos

Las dependencias se mantienen intencionadamente acotadas: Compose y Material 3 para la interfaz, Navigation Compose para las rutas, Lifecycle para integrar ViewModel con Compose y DataStore para guardar el tema. Se usan iconos Material comunes en lugar del paquete `material-icons-extended`. JUnit solo se usa en pruebas locales y no se incluye en el APK.

Gradle ya tiene compilación paralela desactivada y un límite de heap de 2 GB en `gradle.properties`. Si el equipo va justo de memoria, cierra el emulador mientras compilas o prueba en un teléfono físico. Añade una dependencia solo cuando una funcionalidad concreta la necesite.