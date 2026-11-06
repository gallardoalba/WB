package org.wanderbibliothek.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Formatos de fecha: el servidor manda ISO-8601 en UTC y la app lo traduce al
 * idioma elegido. Una fecha mal leída se ve como «hace 20000 min».
 */
class FmtTest {

    private fun iso(offsetMillis: Long): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date(System.currentTimeMillis() - offsetMillis))
    }

    @Test
    fun `una fecha sin zona se lee como utc`() {
        assertEquals("02.01.2026", Fmt.date("2026-01-02T10:00:00.000Z", "de"))
        assertEquals("02.01.2026", Fmt.date("2026-01-02T10:00:00Z", "es"))
        assertEquals("02.01.2026", Fmt.date("2026-01-02", "de"))
    }

    @Test
    fun `una fecha invalida no se inventa`() {
        assertEquals("no-fecha", Fmt.date("no-fecha", "de"))
        assertEquals("no-fecha", Fmt.relative("no-fecha", "es"))
    }

    @Test
    fun `lo reciente se cuenta en minutos y horas`() {
        assertEquals("ahora", Fmt.relative(iso(10_000), "es"))
        assertEquals("gerade", Fmt.relative(iso(10_000), "de"))
        assertEquals("hace 5 min", Fmt.relative(iso(5 * 60_000L), "es"))
        assertEquals("vor 5 Min.", Fmt.relative(iso(5 * 60_000L), "de"))
        assertEquals("hace 2 h", Fmt.relative(iso(2 * 3_600_000L), "es"))
    }
}
