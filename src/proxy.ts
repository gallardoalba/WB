import { NextResponse, type NextRequest } from "next/server";
import { requestIdFrom, REQUEST_ID_HEADER } from "@/lib/observability";

/**
 * Rutas que no deben indexarse: la misma lista que el `disallow` de
 * `robots.txt`, más `/buscar` (que ya lleva `noindex` en sus metadatos).
 */
const PRIVATE_PREFIXES = [
  "/api/",
  "/descubrir",
  "/libro/",
  "/obra/",
  "/u/",
  "/lectores",
  "/comunidad",
  "/clubes",
  "/estanteria",
  "/intercambios",
  "/cuenta",
  "/ofrecer",
  "/verificar",
  "/restablecer",
  "/buscar",
];

/**
 * Cabeceras de seguridad para todas las rutas.
 *
 * La CSP usa un nonce por petición: Next lo propaga a sus propios scripts y así
 * un XSS que inyecte `<script>` no puede ejecutarse. En desarrollo se añade
 * `unsafe-eval` porque el refresco en caliente lo necesita.
 */
export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  // Solo se habilita el host de Turnstile si el registro lo usa.
  const turnstile = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const turnstileScript = turnstile ? " https://challenges.cloudflare.com" : "";
  const turnstileFrame = turnstile ? "frame-src https://challenges.cloudflare.com;" : "";
  const turnstileConnect = turnstile
    ? " https://challenges.cloudflare.com"
    : "";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}${turnstileScript}`,
    // Next inyecta estilos inline; no se pueden marcar todos con nonce.
    "style-src 'self' 'unsafe-inline'",
    // Las portadas se sirven desde `/api/cover/...`: el navegador no habla con
    // ningún tercero, así que no se autoriza ningún origen externo de imagen.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}${turnstileConnect}`,
    turnstileFrame,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ]
    .filter(Boolean)
    .join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  // Un id por petición, del proxy de delante si lo manda. Viaja a la respuesta,
  // a las rutas de API (que lo usan en el cuerpo del error) y al registro.
  requestHeaders.set(REQUEST_ID_HEADER, requestIdFrom(request.headers));

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  // Las páginas que reciben un enlace de un solo uso llevan el token en la
  // query: sin `no-referrer`, los recursos de la propia página lo mandarían en
  // el `Referer` y acabaría en el registro. En el resto basta el valor normal.
  const unaSolaVez =
    request.nextUrl.pathname === "/verificar" || request.nextUrl.pathname === "/restablecer";
  response.headers.set(
    "Referrer-Policy",
    unaSolaVez ? "no-referrer" : "strict-origin-when-cross-origin",
  );
  // Sin el escáner de ISBN no queda ninguna función que use la cámara: se
  // cierra también esa.
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  // Vistas con sesión: `robots.txt` ya las bloquea, pero sin sesión responden
  // 200 con una redirección en el cliente (Next no puede cambiar el estado una
  // vez emitido el shell). La cabecera cierra el caso de la URL descubierta por
  // un enlace externo: Google no la indexa aunque llegue a pedirla.
  if (PRIVATE_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  if (request.nextUrl.pathname.startsWith("/admin")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set(REQUEST_ID_HEADER, requestHeaders.get(REQUEST_ID_HEADER)!);
  if (!isDev) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
