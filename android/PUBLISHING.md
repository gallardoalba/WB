# Publicar en Google Play

Checklist para llevar la app de `android/` a Play Store. Lo que ya está
resuelto se marca con ✔ y lo que falta, con ⬜.

## 1. Cuenta de desarrollador

- ⬜ Cuenta de Google Play Console (25 USD una vez) con **verificación de
  identidad** (documento) y **verificación en dos pasos** obligatoria.
- ⬜ Elegir tipo: **personal** o **organización**. Una organización necesita un
  número D-U-N-S verificado; una personal no, pero:
  - ⚠ Si la cuenta es personal y se creó **después del 13-11-2023**, antes de
    pedir producción hay que hacer una **prueba cerrada con al menos 12
    testers** que hayan aceptado la invitación y **14 días consecutivos** con la
    app publicada en esa pista. Es el plazo más largo de todo el proceso, así
    que conviene empezarlo el primero.

## 2. Formato y firma

- ✔ El paquete es `org.wanderbibliothek.app` con `minSdk 24` y `targetSdk 37`,
  por encima del mínimo que Play exige cada año.
- ✔ El release no es `debuggable` y solo declara el permiso `INTERNET`.
- ⬜ Play **no acepta APK** para apps nuevas: hay que subir un **AAB**.

```sh
./scripts/build-apk.sh --bundle --bump --version 1.0.0
```

Ese comando compila `bundleRelease`, comprueba la firma del AAB con
`jarsigner` y lo deja en `dist/wanderbibliothek-<versión>.aab`. El AAB no se
instala a mano en un teléfono: se sube a la consola y Play genera los APK por
dispositivo.

- ⬜ Activar **Play App Signing** al crear la app: se sube el AAB firmado con la
  *upload key* (`~/wanderbibliothek.jks`) y Google custodia la clave de firma
  definitiva. Si se pierde la upload key, se puede pedir un restablecimiento.
- ✔ Cada subida necesita un `versionCode` mayor (`--bump` lo hace).

## 3. Ficha de la tienda

- ⬜ Icono **512×512 PNG** (el icono adaptativo de la app no sirve como asset de
  la ficha).
- ⬜ Gráfico destacado **1024×500 PNG/JPG**.
- ⬜ Entre 2 y 8 **capturas de teléfono** (mínimo 320 px de lado).
- ⬜ Nombre (≤30 caracteres), descripción corta (≤80) y descripción larga
  (≤4000), en **alemán** (principal) y **castellano**.
- ⬜ Categoría: **Libros y referencia**.

## 4. Declaraciones obligatorias

- ✔ Política de privacidad publicada: `https://wanderbibliothek.org/privacidad`.
- ⬜ **URL de eliminación de cuenta**. Play la exige en cuanto hay registro. Hoy
  el borrado existe en la app (Cuenta → Eliminar mi cuenta) y en la web
  (`/cuenta`, con sesión), pero la consola pide una URL pública que explique el
  proceso y qué se borra: falta una página tipo `/cuenta/eliminar` (o una
  sección anclada en `/privacidad`) sin necesidad de iniciar sesión.
- ⬜ **Seguridad de los datos**: declarar que se recogen nombre, correo, ciudad y
  mensajes; que el tráfico va cifrado (✔ HTTPS); que los mensajes están
  cifrados de extremo a extremo y el servidor no los puede leer; que el correo
  transaccional se envía con Brevo (encargado del tratamiento); y que la persona
  puede borrar su cuenta y sus datos desde la app.
- ⬜ **Clasificación de contenido** (cuestionario IARC): contenido generado por
  usuarios (perfiles, clubes, foro y mensajería) y moderación existente.
- ⬜ **Público objetivo**: la app pide 16 años al registrarse, así que se declara
  para mayores de 16/18 y **no** para el programa de Familias.
- ✔ Sin anuncios y sin compras integradas (no aplica Play Billing).
- ⬜ **Acceso a la app** para revisión: crear una cuenta de prueba
  (`demo...@wanderbibliothek.test`) y dejar usuario y contraseña en la consola.

## 5. Contenido generado por usuarios (bloqueante)

La política de Play exige que una app con contenido de otras personas (y más con
mensajería) permita **denunciar** y **bloquear** dentro de la app:

- ✔ El servidor ya tiene `POST /api/reports` y `/api/blocks` (la web los usa).
- ⬜ La **app Android no los expone**: `WanderRepository` no tiene ni denuncia ni
  bloqueo, y no hay textos para ello. Sin esto la revisión puede rechazar la
  app, no por la ficha sino por la política de UGC.

## 6. Pistas de prueba

1. **Interna** (hasta 100 testers, disponible en minutos): instalar y probar el
   AAB real que se subirá.
2. **Cerrada**: la que exige 12 testers × 14 días si la cuenta es personal.
3. **Producción**: revisión de Google, normalmente entre 1 y 7 días la primera
   vez.

Para probar un AAB en un teléfono sin subirlo, `bundletool` lo convierte en APK:

```sh
bundletool build-apks --bundle=dist/wanderbibliothek-1.0.0.aab \
  --output=/tmp/app.apks --mode=universal --ks=~/wanderbibliothek.jks --ks-key-alias=wanderbibliothek
bundletool install-apks --apks=/tmp/app.apks
```

## 7. Riesgos propios de este proyecto

- **La clave de cifrado vive en el Keystore del teléfono**: al desinstalar o
  cambiar de dispositivo se pierde. Quien reinstale tendrá que publicar una clave
  nueva (la app ya pide la contraseña y el servidor avisa a los interlocutores).
  Conviene decirlo en la ficha y en la política de privacidad.
- **La mensajería directa depende del seguimiento mutuo** y del bloqueo; si se
  publica en Play, revisar que el bloqueo exista también en la app (punto 5).
- **Servidor único**: la app apunta a `https://wanderbibliothek.org`. Si se cae,
  la app no tiene modo sin conexión más allá de la caché de portadas.
