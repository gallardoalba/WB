package org.wanderbibliothek.app.data

import java.util.Locale

/**
 * Idioma de la interfaz.
 *
 * La app no tiene selector de idioma: sigue el del teléfono. Castellano e
 * inglés se reconocen solos; cualquier otro idioma usa el alemán, que es el
 * idioma por defecto de la plataforma. Vive en `data` porque lo usan tanto la
 * capa de red (cookie de idioma para los mensajes del servidor) como la de
 * interfaz (catálogo de textos), y así la regla está escrita una sola vez.
 */
object Languages {
    fun fromSystem(language: String? = Locale.getDefault().language): String =
        if (language == "es" || language == "en") language else "de"
}
