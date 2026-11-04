# Política de seguridad

Wanderbibliothek gestiona cuentas, sesiones, datos personales (ciudad, biografía,
correo) y mensajería cifrada de extremo a extremo. Los fallos de seguridad se
tratan como prioritarios.

## Versiones soportadas

El proyecto se publica como aplicación, no como librería: solo se da soporte de
seguridad a la **última versión de la rama `main`**. Si autohospedas una copia,
actualiza antes de reportar.

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Usa la pestaña **Security → Report a
vulnerability** del repositorio (GitHub Security Advisories): es privada y no
expone tu correo ni el detalle del fallo.

Incluye, si puedes:

- impacto y escenario de explotación;
- pasos para reproducirlo (versión o commit, configuración relevante);
- si afecta a datos de otras personas o solo al propio atacante.

Compromiso de respuesta: acuse de recibo en **72 horas** y una primera
valoración en **7 días**. Cuando el fallo esté corregido se publicará el aviso
correspondiente y se te acreditará si lo deseas.

## Alcance

Se consideran vulnerabilidades, entre otras:

- saltarse la autenticación, la verificación en dos pasos o la autorización por
  rol (por ejemplo, moderar sin ser administración);
- leer o modificar datos de otra cuenta (ejemplares, solicitudes, avisos,
  listas, clubes);
- romper el cifrado de la mensajería, filtrar contenido de mensajes al servidor
  o exponer claves privadas;
- XSS, CSRF, inyección SQL, SSRF, redirecciones abiertas;
- bypass de los límites de peticiones o de las cuotas;
- exponer secretos, tokens de sesión o datos personales en respuestas, logs o
  cabeceras;
- escalada de privilegios en el proceso de despliegue.

Quedan **fuera** de alcance: fuerza bruta o spam con cuentas propias, denegación
de servicio volumétrica contra una instancia concreta, ingeniería social,
contenido publicado por otras personas (usa el botón de denuncia) y resultados
de escáneres automáticos sin impacto demostrado.

## Buenas prácticas para quien autohospeda

- Sirve siempre por **HTTPS**: la cookie de sesión es `__Host-` y el navegador la
  descarta sobre HTTP.
- Define `APP_ENCRYPTION_KEY`, `MAIL_WEBHOOK_URL`, `MAINTENANCE_TOKEN` y
  `TRUST_PROXY=1` antes de abrir el registro público (el arranque avisa de lo que
  falte).
- Activa la verificación en dos pasos en la cuenta de administración.
- Mantén las copias de seguridad cifradas y **fuera** del servidor.
- No publiques el fichero `.data/` ni el contenido de `/var/lib/wanderbibliothek`.
