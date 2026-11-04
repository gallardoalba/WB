/**
 * Lista corta de contraseñas prohibidas. No sustituye a un servicio de
 * contraseñas filtradas, pero frena las elecciones obvias sin coste.
 */
const COMMON = new Set([
  "1234567890",
  "12345678901",
  "123456789012",
  "password123",
  "contrasena",
  "contraseña",
  "contraseña1",
  "qwertyuiop",
  "qwerty12345",
  "iloveyou123",
  "administrador",
  "administrator",
  "bienvenido",
  "bienvenido1",
  "wanderbibliothek",
  "wanderbibliothek123",
  "micontraseña",
  "soyuncrack1",
  "abcdefghij",
  "aaaaaaaaaa",
  "1111111111",
  "0000000000",
]);

export function isCommonPassword(password: string): boolean {
  return COMMON.has(password.trim().toLowerCase());
}
