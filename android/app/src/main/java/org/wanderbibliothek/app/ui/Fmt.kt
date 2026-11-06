package org.wanderbibliothek.app.ui

import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Formatos de fecha y número.
 *
 * El servidor envía ISO-8601 en UTC; aquí se pasa a la zona del dispositivo y
 * al formato del idioma elegido. `SimpleDateFormat` no es seguro entre hilos,
 * así que se crea uno por llamada: son pocas y baratas.
 */
object Fmt {

    private val isoPatterns = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd",
    )

    private fun parse(iso: String): Date? {
        isoPatterns.forEach { pattern ->
            val date = runCatching {
                SimpleDateFormat(pattern, Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                    isLenient = false
                }.parse(iso)
            }.getOrNull()
            if (date != null) return date
        }
        return null
    }

    private fun locale(lang: String) =
        if (lang == "es") Locale.forLanguageTag("es-ES") else Locale.forLanguageTag("de-DE")

    fun date(iso: String, lang: String): String {
        val date = parse(iso) ?: return iso.take(10)
        return SimpleDateFormat("dd.MM.yyyy", locale(lang)).format(date)
    }

    fun dateTime(iso: String, lang: String): String {
        val date = parse(iso) ?: return iso
        return SimpleDateFormat("dd.MM.yyyy HH:mm", locale(lang)).format(date)
    }

    fun relative(iso: String, lang: String): String {
        val date = parse(iso) ?: return date(iso, lang)
        val diff = System.currentTimeMillis() - date.time
        return when {
            diff < 60_000 -> if (lang == "es") "ahora" else "gerade"
            diff < 3_600_000 -> {
                val minutes = diff / 60_000
                if (lang == "es") "hace $minutes min" else "vor $minutes Min."
            }
            diff < 86_400_000 -> {
                val hours = diff / 3_600_000
                if (lang == "es") "hace $hours h" else "vor $hours Std."
            }
            else -> date(iso, lang)
        }
    }

    fun number(value: Int, lang: String): String =
        NumberFormat.getIntegerInstance(locale(lang)).format(value)

}
