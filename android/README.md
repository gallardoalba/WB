# Wanderbibliothek para Android

Cliente nativo de la plataforma, escrito en Kotlin y Jetpack Compose. Habla
directamente con la API REST de Wanderbibliothek; no envuelve la web en un
WebView.

## Qué incluye

- **Descubrir**: catálogo público con búsqueda, filtros (categoría, orden,
  radio) y paginación.
- **Ficha del ejemplar**: portada, ficha bibliográfica, ejemplares parecidos,
  favorito, solicitud de intercambio y «añadir a una lista».
- **Estantería**: mis ejemplares y los guardados; cambio de estado (disponible,
  en pausa, entregado) y retirada del catálogo.
- **Ofrecer**: alta con búsqueda de ISBN en la DNB/Open Library.
- **Intercambios**: lista, detalle, aceptar/rechazar/retirar, código de entrega,
  método (en mano o por correo), datos de envío y chat.
- **Clubes**: listado, ficha, entrada/salida, asistencia al encuentro,
  votaciones y foro.
- **Listas de lectura**: escaparate público, listas propias y creación.
- **Cuenta**: perfil, editar perfil (nombre, ciudad, presentación y avisos por
  correo), avisos con enlace a su pantalla, listas, idioma, tema, servidor,
  cambio de contraseña, verificación en dos pasos (con QR), exportación de los
  datos, enlaces legales y baja de la cuenta.
- **Conversación viva**: el chat de un intercambio busca mensajes nuevos cada
  15 s mientras está abierto, y la campana lleva el número de avisos sin leer.
- **Listas paginadas**: clubes y listas públicas cargan de 12 en 12 con «cargar
  más»; el resto de listas ya venía paginado.
- **¿Olvidaste la contraseña?** en la pantalla de entrada: pide el enlace de
  recuperación (el mismo mensaje exista o no la cuenta).

## Seguridad del cliente

- La cookie de sesión y la clave privada del cifrado **no se guardan en claro**:
  van cifradas con AES-GCM y una clave del Keystore de Android
  (`data/SecretBox.kt`). Una copia del almacén de preferencias sin el Keystore
  del dispositivo no sirve para nada. Si el Keystore no deja cifrar, **no se
  escribe nada en disco** (la sesión sigue viva en memoria) en vez de degradar a
  texto plano.
- La sesión se guarda **por host**: cambiar de servidor no reenvía la cookie del
  anterior, y un valor sin el prefijo `enc1:` se descarta aunque esté en el
  almacén.
- Las copias de seguridad y la transferencia entre teléfonos están desactivadas
  (`android:allowBackup="false"` y `res/xml/data_extraction_rules.xml`):
  restaurar una clave cifrada con un Keystore que ya no existe dejaría un estado
  roto y sin explicación.
- La identidad de cifrado es **por cuenta y por servidor**: cambiar de servidor
  o entrar con otra cuenta no reutiliza la clave anterior.
- `HttpURLConnection` no sigue redirecciones (un `302` hacia otro host se
  rechaza antes de enviar cookies) y ninguna respuesta se lee sin límite de
  tamaño.
- Si el servidor responde `401` en una llamada autenticada, la app cierra la
  sesión y vuelve a la pantalla de entrada en vez de enseñar errores sueltos.
- El tráfico de la API es HTTPS; el HTTP en claro solo se permite para el
  emulador y `localhost` (`network_security_config.xml`).

## Requisitos

- JDK 17 o posterior (el proyecto toma el JDK activo o el de Android Studio).
- SDK de Android con la plataforma **37** instalada.
- Un dispositivo o emulador con Android 7.0 (API 24) o posterior.

No hace falta añadir dependencias fuera del SDK: la app usa `HttpURLConnection`
y `org.json` para la red y `java.security` para el cifrado.

## Compilar y ejecutar

```sh
./gradlew :app:assembleDebug
```

El APK queda en `app/build/outputs/apk/debug/app-debug.apk`. Para instalarlo:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

El script `scripts/build-apk.sh` hace lo mismo y un poco más: compila, comprueba
la firma con `apksigner`, sube el `versionCode` si se lo pides y deja el APK con
nombre propio en `dist/`.

```sh
./scripts/build-apk.sh --debug                          # para tu teléfono
./scripts/build-apk.sh                                  # release firmado
./scripts/build-apk.sh --bump --version 0.2.0           # release con versión nueva
```

Para publicar en el catálogo libre, `FDROID.md` (F-Droid compila desde el código
y firma con su propia clave; el APK de `dist/` sirve para instalarlo tú y para
repositorios que acepten tu firma, como IzzyOnDroid).

Pruebas JVM:

```sh
./gradlew :app:testDebugUnitTest
```

Release firmado (el script se niega a seguir si falta la firma):

```sh
./gradlew :app:assembleRelease
```

La firma se toma de `ANDROID_SIGNING_STORE_FILE`, `ANDROID_SIGNING_STORE_PASSWORD`,
`ANDROID_SIGNING_KEY_ALIAS` y `ANDROID_SIGNING_KEY_PASSWORD`. Si falta alguna de
las cuatro, el build de release falla en vez de mezclar una firma a medias. Sin
ninguna, Gradle genera `app-release-unsigned.apk`, que **no se puede instalar**:
para eso está `scripts/build-apk.sh`, que lo detecta antes de compilar y explica
qué exportar. No guardes claves ni contraseñas en el repositorio.

El script pide las contraseñas con la entrada oculta si no están exportadas y,
antes de compilar, comprueba el almacén con `keytool`: que la contraseña lo abra,
que el alias exista y que, al ser PKCS12, las dos contraseñas coincidan. Así el
error «keystore password was incorrect» —que Gradle da un minuto después sin
decir cuál de las dos falla— aparece de inmediato y con la causa.

## Instalar en un teléfono

El APK de depuración ya viene firmado con la clave de depuración, así que sirve
para probar en un teléfono real sin configurar nada:

```sh
./scripts/build-apk.sh --debug
adb install -r dist/wanderbibliothek-0.1.0-debug.apk
```

Antes hay que activar la depuración USB: **Ajustes → Acerca del teléfono**,
tocar siete veces «Número de compilación», y en **Opciones de desarrollador**
activar «Depuración USB». Al conectar el cable el teléfono pide autorizar la
huella RSA de este equipo; sin aceptarla, `adb devices` lo muestra como
`unauthorized`.

**Sin cable**: copia `dist/wanderbibliothek-0.1.0-debug.apk` al teléfono (correo,
Drive, almacenamiento USB) y ábrelo con el gestor de archivos. Android pedirá
permitir «instalar apps desconocidas» para esa aplicación; es lo normal al no
venir de una tienda de aplicaciones.

⚠ **La clave de depuración es de este equipo**: una actualización compilada en
otra máquina no se instala encima (error `INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
Hay que desinstalar antes, y con ello se pierde la clave de cifrado guardada en
el Keystore. Para compartir la app o actualizarla sin perder datos, firma el
release con un keystore propio:

```sh
keytool -genkeypair -v -keystore ~/wanderbibliothek.jks -alias wanderbibliothek \
  -keyalg RSA -keysize 4096 -validity 10000
export ANDROID_SIGNING_STORE_FILE=~/wanderbibliothek.jks
export ANDROID_SIGNING_KEY_ALIAS=wanderbibliothek
# Las contraseñas se escriben aquí, en tu terminal, nunca en un chat ni en el repo.
./gradlew :app:assembleRelease
```

El APK firmado queda en `app/build/outputs/apk/release/` (`app-release.apk`); el
`app-release-unsigned.apk` **no** se puede instalar.

### Servidor al que se conecta

La app apunta por defecto a `https://wanderbibliothek.org`, así que con datos
móviles funciona sin configurar nada. Para probar contra el servidor local por
USB, sin abrir puertos ni permitir HTTP en la red:

```sh
adb reverse tcp:3100 tcp:3100
```

y en **Ajustes → Dirección del servidor** pon `http://127.0.0.1:3100` (el
`network_security_config.xml` permite HTTP en claro solo para `127.0.0.1`,
`localhost` y `10.0.2.2`).

## Servidor

Por defecto la app habla con `https://wanderbibliothek.org`. En **Ajustes →
Dirección del servidor** se puede cambiar, por ejemplo para probar en local:

- Emulador: `http://10.0.2.2:3100` (con `npm run dev -- -p 3100` y
  `SEED_DEMO=1` en el proyecto web).
- Teléfono en la misma red: `http://<IP-del-equipo>:3100`.

El tráfico sin cifrar solo se permite para `10.0.2.2`, `localhost` y
`127.0.0.1` (`res/xml/network_security_config.xml`); cualquier otro servidor
debe usar HTTPS. Cambiar de servidor cierra la sesión: la cookie es de otro
host y no debe viajar.

⚠ Este cliente necesita la migración **v40** del servidor (dos ranuras de clave).
Las pantallas de clubes, listas, estantería y comunidad usan lecturas JSON
que se añadieron a la API para este cliente (`GET /api/clubs`,
`GET /api/clubs/[clubId]`, `GET /api/shelf`, `GET /api/community`,
`GET /api/lists?scope=public`, `GET /api/lists/[listId]`,
`GET /api/listings/[id]`, `GET /api/requests/[requestId]`). Contra un servidor
antiguo esas pantallas responderán 404 hasta desplegar la versión actual.

## Cifrado de los mensajes

El chat usa el mismo esquema que la web (`src/lib/e2e.ts`): ECDH P-256, HKDF-
SHA256 con el id del intercambio como `info`, AES-GCM-256 y un AAD que ata el
sobre al hilo, al remitente y a la clave.

- La clave privada se genera en el dispositivo y se guarda en el almacén privado
  de la app; el servidor solo recibe la pública.
- Cada cuenta tiene **dos ranuras de clave**: `web` (navegador) y `android`
  (esta app). La app publica siempre en la suya; nunca sustituye la del
  navegador. Como el servidor pide la contraseña en cuanto la cuenta ya tiene
  **cualquier** clave, publicar la del móvil en una cuenta que ya cifraba en el
  navegador también la pide: la pantalla de Ajustes la solicita y no acepta una
  sesión abierta como única prueba.
- Los mensajes nuevos llevan **un sobre por cada clave del destinatario** (lo
  cifra el remitente), así que el navegador y la app leen el mismo mensaje. El
  historial anterior a la segunda clave solo se lee en el dispositivo donde se
  cifró.
- Si un mensaje se cifró con otra clave, se muestra como ilegible en vez de
  romper la pantalla. Perder los datos de la app equivale a perder su clave,
  igual que borrar los datos del navegador en la web.

## Estructura

```
app/src/main/java/org/wanderbibliothek/app/
├── MainActivity.kt
├── data/
│   ├── ApiClient.kt          HTTP, cookies de sesión y errores
│   ├── Models.kt             DTO y lectura de JSON
│   ├── WanderRepository.kt   toda la API, tipada
│   ├── MessageCrypto.kt      E2E compatible con la web
│   ├── Prefs.kt              DataStore: servidor, idioma, tema, sesión, clave
│   ├── SecretBox.kt          cifra secretos con una clave del Keystore
│   ├── SessionBus.kt         avisa a la interfaz de que la sesión caducó
│   ├── Catalogs.kt            categorías, idiomas, estados y etiquetas
│   └── ImageUrl.kt           resuelve las portadas relativas
└── ui/
    ├── WanderApp.kt          navegación y barra inferior
    ├── Texts.kt              diccionario alemán/castellano
    ├── Local.kt              idioma y textos por composición
    ├── Fmt.kt / Labels.kt    fechas, números y enumeraciones
    ├── components/           portadas, tarjetas y estados comunes
    └── screens/              una pantalla por flujo
```

## Límites conocidos

- No incluye mensajería directa entre perfiles, perfil público, administración
  ni alta de clubes: la app cubre los flujos principales de lectura e
  intercambio.
- No hay notificaciones push; los avisos se ven al abrir la pantalla de avisos.
- Las etiquetas temáticas se muestran traducidas, pero el contenido que escriben
  las personas no se traduce.
