package org.wanderbibliothek.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Los tres diccionarios deben tener exactamente las mismas claves. Si alguien
 * añade un texto solo en alemán, la app mostraría la clave cruda en castellano
 * o en inglés; esta prueba lo detecta antes de compilar el APK.
 */
class TextsTest {

    @Test
    fun `de, es y en tienen las mismas claves`() {
        val missingInEs = TextCatalog.de.keys - TextCatalog.es.keys
        val missingInDe = TextCatalog.es.keys - TextCatalog.de.keys
        assertEquals("faltan en castellano: $missingInEs", emptySet<String>(), missingInEs)
        assertEquals("faltan en alemán: $missingInDe", emptySet<String>(), missingInDe)

        val missingInEn = TextCatalog.de.keys - TextCatalog.en.keys
        val extraInEn = TextCatalog.en.keys - TextCatalog.de.keys
        assertEquals("faltan en inglés: $missingInEn", emptySet<String>(), missingInEn)
        assertEquals("sobran en inglés: $extraInEn", emptySet<String>(), extraInEn)
    }

    @Test
    fun `los textos no estan vacios`() {
        TextCatalog.de.forEach { (key, value) ->
            assertNotEquals("clave vacía: $key", "", value.trim())
        }
    }

    @Test
    fun `un idioma desconocido cae en aleman`() {
        assertEquals("Entdecken", TextCatalog.forLanguage("fr")["discover"])
        assertEquals("Descubrir", TextCatalog.forLanguage("es")["discover"])
        assertEquals("Discover", TextCatalog.forLanguage("en")["discover"])
    }

    @Test
    fun `el idioma de la app sale del telefono`() {
        assertEquals("es", TextCatalog.languageFor("es"))
        assertEquals("en", TextCatalog.languageFor("en"))
        assertEquals("de", TextCatalog.languageFor("de"))
        // Cualquier otro idioma del sistema usa el catálogo alemán.
        assertEquals("de", TextCatalog.languageFor("fr"))
        assertEquals("de", TextCatalog.languageFor(null))
    }

    @Test
    fun `format sustituye el marcador`() {
        val texts = TextCatalog.forLanguage("es")
        assertEquals("3 libros", texts.format("results", 3))
    }

    @Test
    fun `format no falla si el tipo no encaja`() {
        val texts = TextCatalog.forLanguage("de")
        // `votes` usa `%d`; pasar texto no debe lanzar, solo degradar.
        assertEquals("3 Stimmen", texts.format("votes", "3"))
    }

    /**
     * La barra inferior reparte cinco destinos en el ancho del móvil. La
     * etiqueta se ajusta sola de tamaño (8–11 sp) y va en una línea, así que no
     * hace falta acortar palabras: «Intercambios» mide 64,9 dp a 11 sp frente a
     * los ~66 dp disponibles. Esta prueba fija el nombre completo y evita que
     * alguien lo cambie por uno más largo.
     */
    @Test
    fun `las etiquetas de la barra caben en un movil estrecho`() {
        val keys = listOf("navDiscover", "navShelf", "navExchanges", "navClubs", "navAccount")
        for (catalog in listOf(TextCatalog.de, TextCatalog.es, TextCatalog.en)) {
            keys.forEach { key ->
                val label = catalog.getValue(key)
                assertTrue("demasiado larga para la barra: «$label»", label.length <= 12)
                assertFalse("sin puntos suspensivos: «$label»", label.contains("…"))
            }
        }
        // El castellano usa la palabra completa, no un sinónimo más corto.
        assertEquals("Intercambios", TextCatalog.es.getValue("navExchanges"))
        assertEquals("Entdecken", TextCatalog.de.getValue("navDiscover"))
        assertEquals("Swaps", TextCatalog.en.getValue("navExchanges"))
    }
}
