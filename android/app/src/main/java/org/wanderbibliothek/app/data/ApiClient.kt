package org.wanderbibliothek.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/** Error de la API con su estado HTTP y el cuerpo original (para 2FA y 422). */
open class ApiException(
    val status: Int,
    override val message: String,
    val payload: JSONObject? = null,
) : Exception(message)

/** La sesión ya no vale: hay que volver a entrar. */
class SessionExpiredException(message: String) : ApiException(401, message)

private class ResponseTooLarge : Exception()

/**
 * Cliente HTTP mínimo contra la API de Wanderbibliothek.
 *
 * No usa ninguna dependencia externa: `HttpURLConnection` y `org.json` vienen
 * con Android. Las cookies de sesión se guardan cifradas en `Prefs` porque el
 * servidor usa `Set-Cookie` (igual que un navegador) y no un token `Bearer`.
 *
 * Las mutaciones no envían `Origin`: el servidor acepta clientes externos sin
 * esa cabecera precisamente para que una app nativa pueda hablar con la API.
 *
 * Las redirecciones **no** se siguen: una respuesta 3xx podría llevar la cookie
 * de sesión a otro host. Si el servidor cambia de origen, el usuario actualiza
 * la dirección en Ajustes.
 */
class ApiClient(private val prefs: Prefs) {

    suspend fun get(path: String, query: Map<String, String> = emptyMap()): JSONObject =
        request("GET", path, query, null)

    suspend fun post(path: String, body: JSONObject? = null): JSONObject =
        request("POST", path, emptyMap(), body)

    suspend fun patch(path: String, body: JSONObject? = null): JSONObject =
        request("PATCH", path, emptyMap(), body)

    suspend fun put(path: String, body: JSONObject? = null): JSONObject =
        request("PUT", path, emptyMap(), body)

    suspend fun delete(path: String): JSONObject = request("DELETE", path, emptyMap(), null)

    /** Descarga de datos de la cuenta: JSON grande, sin parsear. */
    suspend fun getText(path: String, maxBytes: Int = 16_000_000): String {
        val raw = execute("GET", path, emptyMap(), null, maxBytes)
        if (raw.status !in 200..299) fail(raw.status, path, raw.text, null, raw.hadSession)
        return raw.text
    }

    private suspend fun request(
        method: String,
        path: String,
        query: Map<String, String>,
        body: JSONObject?,
    ): JSONObject {
        val raw = execute(method, path, query, body, DEFAULT_MAX_BYTES)
        val payload = raw.text.takeIf { it.isNotBlank() }?.let {
            runCatching { JSONObject(it) }.getOrNull()
        }
        if (raw.status !in 200..299) fail(raw.status, path, raw.text, payload, raw.hadSession)
        return payload ?: JSONObject()
    }

    /** Respuesta cruda: interesa el código, el cuerpo y si llevábamos sesión. */
    private data class Raw(val status: Int, val text: String, val hadSession: Boolean)

    private suspend fun execute(
        method: String,
        path: String,
        query: Map<String, String>,
        body: JSONObject?,
        maxBytes: Int,
        redirects: Int = 0,
    ): Raw = withContext(Dispatchers.IO) {
        val base = prefs.serverUrl().trimEnd('/')
        val host = runCatching { java.net.URL(base).host }.getOrNull().orEmpty()
        val suffix = if (query.isEmpty()) {
            ""
        } else {
            "?" + query.entries.joinToString("&") { (key, value) -> "${encode(key)}=${encode(value)}" }
        }
        val connection = try {
            URL(base + path + suffix).openConnection() as HttpURLConnection
        } catch (_: Exception) {
            throw ApiException(0, "network", null)
        }

        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 25_000
            // Nunca seguir un 3xx con la cookie puesta.
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "Wanderbibliothek-Android/0.2.0")
            val (cookie, hadSession) = cookieHeader(host)
            cookie?.let { connection.setRequestProperty("Cookie", it) }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
            }

            val status = connection.responseCode
            if (status in 300..399) {
                // Un proxy puede normalizar la barra final
                // (`/api/requests` ⇄ `/api/requests/`) con un 301/308. Seguir
                // la redirección a mano solo es seguro si es el mismo host: la
                // cookie de sesión no viaja fuera.
                val retry = if (redirects == 0) {
                    slashVariant(
                        base = base,
                        location = connection.getHeaderField("Location"),
                    )
                } else {
                    null
                }
                if (retry != null) {
                    connection.disconnect()
                    return@withContext execute(method, retry, query, body, maxBytes, redirects + 1)
                }
                throw ApiException(status, "redirect", null)
            }
            prefs.storeCookies(host, setCookies(connection))
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            Raw(status, readCapped(stream, maxBytes), hadSession)
        } catch (error: ApiException) {
            throw error
        } catch (_: ResponseTooLarge) {
            throw ApiException(0, "tooLarge", null)
        } catch (_: Exception) {
            throw ApiException(0, "network", null)
        } finally {
            connection.disconnect()
        }
    }

    /** Sesión del servidor [host] + idioma del teléfono, para que los errores lleguen traducidos. */    private suspend fun cookieHeader(host: String): Pair<String?, Boolean> {
        val session = prefs.cookieHeader(host)
        val parts = mutableListOf<String>()
        session?.let(parts::add)
        parts.add("wanderbibliothek-locale=${Languages.fromSystem()}")
        return parts.takeIf { it.isNotEmpty() }?.joinToString("; ") to (session != null)
    }

    private suspend fun fail(
        status: Int,
        path: String,
        raw: String,
        payload: JSONObject? = null,
        hadSession: Boolean = false,
    ): Nothing {
        val body = payload ?: raw.takeIf { it.isNotBlank() }?.let {
            runCatching { JSONObject(it) }.getOrNull()
        }
        val message = messageFrom(body, status)
        if (status == 401 && !path.startsWith("/api/auth/")) {
            // Sin sesión no hay nada que caducar: es una lectura que pide cuenta.
            if (!hadSession) throw ApiException(401, "signInRequired", body)
            prefs.clearSession()
            SessionBus.notifyExpired()
            throw SessionExpiredException(message)
        }
        throw ApiException(status, message, body)
    }

    private fun setCookies(connection: HttpURLConnection): List<String> =
        connection.headerFields
            .filterKeys { it?.equals("Set-Cookie", ignoreCase = true) == true }
            .values
            .flatten()

    /**
     * Ruta corregida cuando el 3xx solo añade o quita la barra final.
     *
     * Un proxy delante de Next puede normalizar `/api/requests` a
     * `/api/requests/` (o al revés) con un 301/308. La app no sigue
     * redirecciones porque la cookie de sesión no debe viajar a otro origen,
     * pero esta sí es segura: mismo esquema, mismo host y mismo puerto. Si el
     * destino es otro sitio o la ruta cambia, devuelve `null` y el error sube.
     */
    private fun slashVariant(base: String, location: String?): String? {
        if (location.isNullOrBlank()) return null
        val origin = runCatching { java.net.URI(base) }.getOrNull() ?: return null
        val target = runCatching { origin.resolve(location) }.getOrNull() ?: return null
        if (target.scheme?.equals(origin.scheme, ignoreCase = true) != true) return null
        if (target.host == null || !target.host.equals(origin.host, ignoreCase = true)) return null
        if (portOf(target) != portOf(origin)) return null
        if (target.rawQuery != null) return null
        val path = target.rawPath.orEmpty()
        return path.takeIf { it.trimEnd('/').isNotEmpty() }
    }

    private fun portOf(uri: java.net.URI): Int {
        if (uri.port > 0) return uri.port
        return if (uri.scheme?.equals("https", ignoreCase = true) == true) 443 else 80
    }

    private fun messageFrom(payload: JSONObject?, status: Int): String {
        val issues = payload?.optJSONArray("issues")
        if (issues != null) {
            for (index in 0 until issues.length()) {
                val message = issues.optJSONObject(index)?.optString("message").orEmpty()
                if (message.isNotBlank()) return message
            }
        }
        val direct = payload?.optString("error").orEmpty()
        if (direct.isNotBlank()) return direct
        return when (status) {
            0 -> "network"
            401 -> "unauthorized"
            403 -> "forbidden"
            404 -> "notFound"
            405 -> "serverOutdated"
            429 -> "tooManyRequests"
            else -> "error"
        }
    }

    /** Lee como mucho [maxBytes]; una respuesta enorme no debe tumbar la app. */
    private fun readCapped(stream: InputStream?, maxBytes: Int): String {
        if (stream == null) return ""
        stream.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            var total = 0
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                if (total > maxBytes) throw ResponseTooLarge()
                output.write(buffer, 0, read)
            }
            return output.toString("UTF-8")
        }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")

    private companion object {
        const val DEFAULT_MAX_BYTES = 4_000_000
    }
}
