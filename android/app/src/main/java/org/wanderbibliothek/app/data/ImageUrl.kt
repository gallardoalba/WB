package org.wanderbibliothek.app.data

/**
 * Las portadas llegan del servidor como ruta relativa (`/api/cover/…`), igual
 * que en la web. La app necesita la URL absoluta para descargarlas, así que
 * aquí se resuelve contra el servidor configurado.
 */
object ImageUrl {
    @Volatile
    var baseUrl: String = DEFAULT_SERVER_URL

    fun resolve(url: String?): String? {
        if (url.isNullOrBlank()) return null
        return when {
            url.startsWith("http://") || url.startsWith("https://") -> url
            url.startsWith("/") -> baseUrl.trimEnd('/') + url
            else -> url
        }
    }
}
