package org.wanderbibliothek.app.ui

import org.wanderbibliothek.app.data.ApiException
import org.wanderbibliothek.app.data.SessionExpiredException

/**
 * Traduce un fallo al texto que ve la persona.
 *
 * El servidor ya manda mensajes localizados (validación, permisos, cuotas), así
 * que se respeta su texto. Solo los fallos sin cuerpo —red caída, sesión
 * caducada— se sustituyen por los del diccionario local.
 */
fun errorText(texts: Texts, error: Throwable): String {
    if (error is SessionExpiredException) return texts["sessionExpired"]
    if (error is ApiException) {
        return when (error.message) {
            "network" -> texts["networkError"]
            "unauthorized" -> texts["sessionExpired"]
            "forbidden" -> texts["forbidden"]
            "notFound" -> texts["notFound"]
            "serverOutdated" -> texts["serverOutdated"]
            "redirect" -> texts["serverRedirect"]
            "signInRequired" -> texts["signInRequired"]
            "tooManyRequests" -> texts["errorGeneric"]
            "tooLarge" -> texts["errorGeneric"]
            "encryptionUnavailable" -> texts["encryptionUnavailable"]
            else -> error.message.takeIf { it.isNotBlank() } ?: texts["errorGeneric"]
        }
    }
    return error.message?.takeIf { it.isNotBlank() } ?: texts["errorGeneric"]
}
